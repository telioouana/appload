import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { memberPermission } from "@workspace/db/permissions";
import { member, user } from "@workspace/db/users";
import {
    PERMISSIONS,
    PROFILES,
    PROFILE_DEFAULTS,
    PROFILE_LEVEL,
    effectiveAccess,
    isLive,
    isPermission,
    profileOf,
    type Permission,
    type Profile,
} from "@workspace/auth/organization-permissions";
import type { ActivityCatalog } from "@workspace/trpc/activity-log";
import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";
import type { TenantGates } from "@workspace/trpc/tenant-gate";

/**
 * The company's team and who may do what on it (Settings › Equipa): the
 * profiles, the per-person permission changes against them, and the CEO's
 * temporary lift of somebody to acting CEO.
 *
 * Every rule is held here, never in the sheet alone:
 * 1. Managing the team takes a live `team:manage`.
 * 2. One edits only people of a lower profile level than one's own level
 *    (3 while acting CEO) — never oneself, never a CEO. Somebody inside an
 *    acting-CEO window is edited by the real CEO only.
 * 3. Nobody switches on a permission they do not hold themselves right now.
 * 4. Only the real CEO gives or takes back an acting-CEO window.
 * 5. A profile change stays below one's own level both ways, so CEO is never
 *    handed out here — ownership moves only through Appload staff.
 * 6. A profile change starts the person over from the new profile's defaults.
 * 7. A change is taken back by anybody who could have made it.
 *
 * Rows are never deleted: a revoked or lapsed row is the company's record of
 * who was allowed what, and when.
 */

type Tenant = Extract<TenantGates, { ok: true }>;
type Ctx = { db: typeof Database; tenant: Tenant };

const notAllowed = () => new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

/** Rows that can still count: not revoked, not lapsed (a future one included). */
const open = (now: Date) => and(
    isNull(memberPermission.revokedAt),
    or(isNull(memberPermission.endsAt), gt(memberPermission.endsAt, now)),
);

/** One member of the viewer's own company, with what they hold right now. */
async function loadTarget(ctx: Ctx, memberId: string, now: Date) {
    const [row] = await ctx.db
        .select({ id: member.id, role: member.role, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        // The member id comes from input; the company is the gate's
        .where(and(eq(member.id, memberId), eq(member.organizationId, ctx.tenant.organizationId)))
        .limit(1);

    if (!row) throw notFound();

    const changes = await ctx.db
        .select({
            id: memberPermission.id,
            kind: memberPermission.kind,
            permission: memberPermission.permission,
            startsAt: memberPermission.startsAt,
            endsAt: memberPermission.endsAt,
            revokedAt: memberPermission.revokedAt,
            createdAt: memberPermission.createdAt,
            grantedByName: user.name,
        })
        .from(memberPermission)
        .leftJoin(user, eq(user.id, memberPermission.grantedBy))
        .where(and(eq(memberPermission.memberId, row.id), open(now)));

    const profile = profileOf(row.role);

    return { ...row, profile, changes, access: effectiveAccess(profile, changes, now) };
}

type Target = Awaited<ReturnType<typeof loadTarget>>;

/** Rules 1 and 2: may the viewer edit this person at all. */
function mayEdit(tenant: Tenant, target: { id: string; profile: Profile; actingOwner: boolean }): boolean {
    if (!tenant.permissions.has("team:manage")) return false;
    if (target.id === tenant.memberId || target.profile === "owner") return false;
    if (target.actingOwner && tenant.role !== "owner") return false;
    return PROFILE_LEVEL[target.profile] < tenant.level;
}

function assertEdit(tenant: Tenant, target: Target) {
    if (!mayEdit(tenant, { id: target.id, profile: target.profile, actingOwner: target.access.actingOwner })) throw notAllowed();
}

/** Rule 4: the real CEO, never somebody acting as one, over a non-CEO. */
const mayLift = (tenant: Tenant, target: { id: string; profile: Profile }) =>
    tenant.role === "owner" && !tenant.actingOwner && target.profile !== "owner" && target.id !== tenant.memberId;

/** A window that has not already closed, and closes after it opens. */
function assertWindow(startsAt: Date, endsAt: Date | null, now: Date) {
    if (endsAt && (endsAt <= startsAt || endsAt <= now)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_WINDOW" });
    }
}

const PermissionInput = z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]]);

const done = (target: Target, extra: Record<string, unknown> = {}) => ({ memberId: target.id, memberName: target.name, ...extra });

export const teamRouter = createTRPCRouter({
    /** Everybody on the company, and which of them the viewer may edit. */
    members: tenantProcedure.query(async ({ ctx }) => {
        const now = new Date();
        const rows = await ctx.db
            .select({
                id: member.id,
                userId: member.userId,
                role: member.role,
                createdAt: member.createdAt,
                name: user.name,
                email: user.email,
                image: user.image,
            })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .where(eq(member.organizationId, ctx.tenant.organizationId))
            .orderBy(member.createdAt);

        const lifts = rows.length === 0 ? [] : await ctx.db
            .select({
                id: memberPermission.id,
                memberId: memberPermission.memberId,
                startsAt: memberPermission.startsAt,
                endsAt: memberPermission.endsAt,
                revokedAt: memberPermission.revokedAt,
            })
            .from(memberPermission)
            .where(and(
                eq(memberPermission.organizationId, ctx.tenant.organizationId),
                eq(memberPermission.kind, "acting_owner"),
                open(now),
            ));

        return rows.map((row) => {
            const profile = profileOf(row.role);
            const lift = profile === "owner" ? undefined : lifts.find((change) => change.memberId === row.id);
            const actingOwner = lift ? isLive(lift, now) : false;

            return {
                id: row.id,
                userId: row.userId,
                name: row.name,
                email: row.email,
                image: row.image,
                createdAt: row.createdAt,
                profile,
                level: PROFILE_LEVEL[profile],
                actingOwner: lift ? { id: lift.id, live: actingOwner, startsAt: lift.startsAt, endsAt: lift.endsAt } : null,
                isSelf: row.id === ctx.tenant.memberId,
                editable: mayEdit(ctx.tenant, { id: row.id, profile, actingOwner }),
            };
        });
    }),

    permissions: createTRPCRouter({
        /**
         * One person's permissions: the profile's starting set, what they hold
         * now, and every change still open. Anybody reads their own; reading
         * somebody else's takes `team:manage`.
         */
        get: tenantProcedure
            .input(z.object({ memberId: z.string().nonempty() }))
            .query(async ({ ctx, input }) => {
                const now = new Date();
                const self = input.memberId === ctx.tenant.memberId;

                if (!self && !ctx.tenant.permissions.has("team:manage")) throw notAllowed();

                const target = await loadTarget(ctx, input.memberId, now);
                const editable = mayEdit(ctx.tenant, { id: target.id, profile: target.profile, actingOwner: target.access.actingOwner });
                const lift = target.changes.find((change) => change.kind === "acting_owner") ?? null;

                return {
                    memberId: target.id,
                    name: target.name,
                    email: target.email,
                    profile: target.profile,
                    level: target.access.level,
                    actingOwner: target.access.actingOwner,
                    defaults: [...PROFILE_DEFAULTS[target.profile]],
                    permissions: PERMISSIONS.filter((permission) => target.access.permissions.has(permission)),
                    changes: target.changes
                        .filter((change) => change.kind !== "acting_owner")
                        .map((change) => ({
                            id: change.id,
                            kind: change.kind,
                            permission: change.permission,
                            startsAt: change.startsAt,
                            endsAt: change.endsAt,
                            live: isLive(change, now),
                            grantedByName: change.grantedByName,
                        })),
                    actingWindow: lift ? { id: lift.id, startsAt: lift.startsAt, endsAt: lift.endsAt, live: isLive(lift, now), grantedByName: lift.grantedByName } : null,
                    self,
                    editable,
                    // The ceiling: what the viewer holds is all they can switch on
                    grantable: editable ? PERMISSIONS.filter((permission) => ctx.tenant.permissions.has(permission)) : [],
                    canLift: mayLift(ctx.tenant, target),
                };
            }),

        /**
         * Switches one permission on or off for one person, for good or for a
         * window. Whatever was open on that permission is closed first, so the
         * row written here is the only one that counts; switching it back to
         * the profile's own default with no window writes nothing at all.
         */
        set: tenantProcedure
            .input(z.object({
                memberId: z.string().nonempty(),
                permission: PermissionInput,
                on: z.boolean(),
                startsAt: z.date().optional(),
                endsAt: z.date().nullish(),
            }))
            .mutation(async ({ ctx, input }) => {
                const now = new Date();
                const target = await loadTarget(ctx, input.memberId, now);

                assertEdit(ctx.tenant, target);
                if (input.on && !ctx.tenant.permissions.has(input.permission)) throw notAllowed();

                const startsAt = input.startsAt ?? now;
                const endsAt = input.endsAt ?? null;
                assertWindow(startsAt, endsAt, now);

                await ctx.db
                    .update(memberPermission)
                    .set({ revokedAt: now, revokedBy: ctx.tenant.userId })
                    .where(and(
                        eq(memberPermission.memberId, target.id),
                        eq(memberPermission.permission, input.permission),
                        inArray(memberPermission.kind, ["grant", "remove"]),
                        open(now),
                    ));

                const byDefault = PROFILE_DEFAULTS[target.profile].includes(input.permission);
                const windowed = input.startsAt !== undefined || endsAt !== null;

                if (input.on !== byDefault || windowed) {
                    await ctx.db.insert(memberPermission).values({
                        organizationId: ctx.tenant.organizationId,
                        memberId: target.id,
                        kind: input.on ? "grant" : "remove",
                        permission: input.permission,
                        startsAt,
                        endsAt,
                        grantedBy: ctx.tenant.userId,
                    });
                }

                return done(target, { permission: input.permission, on: input.on });
            }),

        /**
         * Takes one change back (rule 7). Taking back a removal switches the
         * permission on again, so it is held to the ceiling like any other
         * switching on.
         */
        revoke: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }) => {
                const now = new Date();
                const [row] = await ctx.db
                    .select({ memberId: memberPermission.memberId, kind: memberPermission.kind, permission: memberPermission.permission })
                    .from(memberPermission)
                    .where(and(
                        eq(memberPermission.id, input.id),
                        eq(memberPermission.organizationId, ctx.tenant.organizationId),
                        inArray(memberPermission.kind, ["grant", "remove"]),
                        open(now),
                    ))
                    .limit(1);

                if (!row) throw notFound();

                const target = await loadTarget(ctx, row.memberId, now);
                assertEdit(ctx.tenant, target);
                if (row.kind === "remove" && row.permission && isPermission(row.permission) && !ctx.tenant.permissions.has(row.permission)) {
                    throw notAllowed();
                }

                await ctx.db
                    .update(memberPermission)
                    .set({ revokedAt: now, revokedBy: ctx.tenant.userId })
                    .where(eq(memberPermission.id, input.id));

                return done(target, { permission: row.permission, kind: row.kind });
            }),
    }),

    actingOwner: createTRPCRouter({
        /**
         * Lifts somebody to acting CEO for a window, which has to end. One
         * window per person: a new one replaces whatever was open.
         */
        grant: tenantProcedure
            .input(z.object({ memberId: z.string().nonempty(), startsAt: z.date().optional(), endsAt: z.date() }))
            .mutation(async ({ ctx, input }) => {
                const now = new Date();
                const target = await loadTarget(ctx, input.memberId, now);

                if (!mayLift(ctx.tenant, target)) throw notAllowed();

                const startsAt = input.startsAt ?? now;
                assertWindow(startsAt, input.endsAt, now);

                await ctx.db
                    .update(memberPermission)
                    .set({ revokedAt: now, revokedBy: ctx.tenant.userId })
                    .where(and(eq(memberPermission.memberId, target.id), eq(memberPermission.kind, "acting_owner"), open(now)));

                await ctx.db.insert(memberPermission).values({
                    organizationId: ctx.tenant.organizationId,
                    memberId: target.id,
                    kind: "acting_owner",
                    permission: null,
                    startsAt,
                    endsAt: input.endsAt,
                    grantedBy: ctx.tenant.userId,
                });

                return done(target, { startsAt: startsAt.toISOString(), endsAt: input.endsAt.toISOString() });
            }),

        revoke: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }) => {
                const now = new Date();
                const [row] = await ctx.db
                    .select({ memberId: memberPermission.memberId })
                    .from(memberPermission)
                    .where(and(
                        eq(memberPermission.id, input.id),
                        eq(memberPermission.organizationId, ctx.tenant.organizationId),
                        eq(memberPermission.kind, "acting_owner"),
                        open(now),
                    ))
                    .limit(1);

                if (!row) throw notFound();

                const target = await loadTarget(ctx, row.memberId, now);
                if (!mayLift(ctx.tenant, target)) throw notAllowed();

                await ctx.db
                    .update(memberPermission)
                    .set({ revokedAt: now, revokedBy: ctx.tenant.userId })
                    .where(eq(memberPermission.id, input.id));

                return done(target);
            }),
    }),

    /**
     * A new profile, which starts the person over from its defaults: their
     * open grants and removals close (an acting-CEO window is the CEO's to
     * close, and stays).
     */
    changeProfile: tenantProcedure
        .input(z.object({ memberId: z.string().nonempty(), profile: z.enum(PROFILES) }))
        .mutation(async ({ ctx, input }) => {
            const now = new Date();
            const target = await loadTarget(ctx, input.memberId, now);

            assertEdit(ctx.tenant, target);
            if (PROFILE_LEVEL[input.profile] >= ctx.tenant.level) throw notAllowed();

            await ctx.db
                .update(member)
                .set({ role: input.profile })
                .where(and(eq(member.id, target.id), eq(member.organizationId, ctx.tenant.organizationId)));

            await ctx.db
                .update(memberPermission)
                .set({ revokedAt: now, revokedBy: ctx.tenant.userId })
                .where(and(
                    eq(memberPermission.memberId, target.id),
                    inArray(memberPermission.kind, ["grant", "remove"]),
                    open(now),
                ));

            return done(target, { from: target.profile, profile: input.profile });
        }),

    /**
     * Takes somebody off the company's portal. Their permission rows go with
     * the member row (cascade). Never a CEO, so the last one cannot go, and
     * never oneself.
     */
    remove: tenantProcedure
        .input(z.object({ memberId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }) => {
            const target = await loadTarget(ctx, input.memberId, new Date());

            assertEdit(ctx.tenant, target);

            await ctx.db
                .delete(member)
                .where(and(eq(member.id, target.id), eq(member.organizationId, ctx.tenant.organizationId)));

            return done(target, { profile: target.profile });
        }),
});

/**
 * Display-safe params for the company's activity log: whose permissions
 * changed, which one, which way and for how long. The person's name is what
 * the log already shows for actors; never their email.
 */
const memberEntity = (input?: { memberId?: unknown }, output?: { memberId?: string }) => {
    const id = output?.memberId ?? input?.memberId;
    return id ? { type: "member", id: String(id) } : null;
};
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null);
const name = (output?: { memberName?: string }) => output?.memberName ?? "";

export const teamCatalog: ActivityCatalog = {
    "team.permissions.set": {
        entity: memberEntity,
        params: (input, output) => ({
            member: name(output),
            permission: String(input?.permission ?? ""),
            on: Boolean(input?.on),
            startsAt: iso(input?.startsAt),
            endsAt: iso(input?.endsAt),
        }),
    },
    "team.permissions.revoke": {
        entity: memberEntity,
        params: (_input, output) => ({ member: name(output), permission: output?.permission ?? null, kind: output?.kind ?? null }),
    },
    "team.actingOwner.grant": {
        entity: memberEntity,
        params: (input, output) => ({ member: name(output), startsAt: iso(input?.startsAt), endsAt: iso(input?.endsAt) }),
    },
    "team.actingOwner.revoke": { entity: memberEntity, params: (_input, output) => ({ member: name(output) }) },
    "team.changeProfile": {
        entity: memberEntity,
        params: (input, output) => ({ member: name(output), from: output?.from ?? null, profile: String(input?.profile ?? "") }),
    },
    "team.remove": { entity: memberEntity, params: (_input, output) => ({ member: name(output), profile: output?.profile ?? null }) },
};
