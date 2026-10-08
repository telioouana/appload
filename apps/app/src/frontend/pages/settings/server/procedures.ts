import { z } from "zod";
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import { activityLog } from "@workspace/db/activity-log";
import { partnerConnection } from "@workspace/db/connections";
import { contract } from "@workspace/db/contracts";
import { movement } from "@workspace/db/movements";
import { order } from "@workspace/db/orders";
import { organization, user } from "@workspace/db/users";
import { AddressSchema, type Address } from "@workspace/db/types";

import {
    PLAN_QUOTA,
    SUBSCRIPTION_PLAN,
    trackingAllowance,
    type SubscriptionPlan,
    type TrackingAllowance,
} from "@workspace/domain/subscription";

import { conditionCount } from "@workspace/domain/orders/predicates";
import { pendingOfferCount } from "@workspace/domain/orders/transition";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, ownerProcedure, tenantProcedure } from "@workspace/trpc/tenant";
import type { Permission } from "@workspace/auth/organization-permissions";
import { DisabledModulesSchema, moduleConflict, type ModuleId } from "@workspace/auth/organization-modules";
import type { OrgStatus, OrgType, TenantPlan, TenantRole } from "@workspace/trpc/tenant-gate";

import { activeGrant, grantHistory, grantSupport, revokeSupport } from "@workspace/domain/support/grants";
import { ChangePasswordBaseSchema, SupportGrantBaseSchema } from "@/backend/schemas/settings";
import { UpdateCompanyBaseSchema } from "@/backend/schemas/company";
import { received, sectionPredicate, visibleMovements } from "@/frontend/pages/movements/server/projection";
import { visibleOrders } from "@/frontend/pages/orders/server/projection";

/**
 * The numbers on the rail, each for the one list it leads to: the loads
 * waiting on this company's answer (a partner's offer, or an Appload order it
 * has been asked to move), its own orders a partner turned down (to place
 * again), the quotes a client still has to decide, the booked orders with
 * nobody driving yet, the loads a dispute holds on each list, and the
 * connection requests it has not answered.
 */
export type RailCounts = {
    received: number;
    declined: number;
    /** Shipper: quotes on its orders waiting on a decision */
    offersToReview: number;
    /** Carrier: orders booked to it with nobody named to drive them */
    toDispatch: number;
    disputes: { orders: number; trips: number };
    partners: number;
    /** Multi-trip orders a transporter proposed, still waiting on this company's answer */
    proposals: number;
};

export type MeSession = {
    user: { id: string; name: string; email: string; image: string | null };
    organization: {
        id: string;
        name: string;
        type: OrgType;
        status: OrgStatus;
        nuit: string;
        email: string;
        phoneNumber: string;
        billingAddress: Address | null;
        physicalAddress: Address | null;
        kycStatus: string;
        /** Null until staff agree a plan with the company */
        subscriptionPlan: SubscriptionPlan | null;
        subscriptionExpiresAt: Date | null;
        portalActivatedAt: Date | null;
    };
    /** The member's profile; what they may do is `permissions` */
    role: TenantRole;
    /** 3 while an acting-CEO window is open */
    level: 1 | 2 | 3;
    actingOwner: boolean;
    /** Live permissions, profile defaults with this member's changes applied */
    permissions: Permission[];
    /** The modules the company has on; what it may switch is `modulesFor(type)` */
    modules: ModuleId[];
    /** False until the CEO answered the module questions once (null column) */
    modulesConfigured: boolean;
    plan: TenantPlan;
    /** This month's tracked movements against what the plan allows */
    allowance: TrackingAllowance;
    /** Every tier and its monthly allowance, so the plan screens can list them */
    tiers: Array<{ plan: SubscriptionPlan; quota: number | null }>;
};

// The catalog lives in a module the browser cannot load (it reads the
// database), so the tiers travel to the client as data rather than as an
// import
const TIERS = SUBSCRIPTION_PLAN.map((plan) => ({ plan, quota: PLAN_QUOTA[plan] }));

/**
 * The violated constraint name when the error (or its cause) is a postgres
 * unique violation (23505), else null — how duplicates become domain codes.
 * The same helper the onboarding router keeps private; the two rows are the
 * organization's own unique columns, and both writers have to name them.
 */
function uniqueViolationConstraint(error: unknown): string | null {
    const candidates = [error, (error as { cause?: unknown })?.cause] as Array<
        { code?: string; constraint_name?: string; detail?: string } | undefined
    >;

    for (const candidate of candidates) {
        if (candidate?.code === "23505") {
            return candidate.constraint_name ?? candidate.detail ?? "";
        }
    }

    return null;
}

/**
 * The form keeps its two addresses as four (possibly empty) strings, because
 * react-hook-form has to seed something. `AddressSchema` is what decides:
 * anything short of a complete picked place is stored as null rather than as
 * a half address the maps and PDFs could not use.
 */
function toAddress(value: Partial<Address> | undefined): Address | null {
    const parsed = AddressSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

/**
 * The tenant's own account and company (plan §5, `me`): what the settings
 * page reads, the company edits owners and admins may make, and the password
 * change. Everything is scoped to `ctx.tenant`, never to an id from input.
 */
export const meRouter = createTRPCRouter({
    /**
     * Who is signed in and which company the portal is showing. Read live
     * rather than from the session cookie: the organization row carries the
     * plan and the KYC verdict, both of which staff change in Admin while a
     * partner is signed in.
     */
    session: tenantProcedure.query(async ({ ctx }): Promise<MeSession> => {
        const [account, company, allowance] = await Promise.all([
            ctx.db
                .select({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    image: user.image,
                })
                .from(user)
                .where(eq(user.id, ctx.tenant.userId))
                .limit(1)
                .then((rows) => rows[0]),
            ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    status: organization.status,
                    nuit: organization.nuit,
                    email: organization.email,
                    phoneNumber: organization.phoneNumber,
                    billingAddress: organization.billingAddress,
                    physicalAddress: organization.physicalAddress,
                    kycStatus: organization.kycStatus,
                    subscriptionPlan: organization.subscriptionPlan,
                    subscriptionExpiresAt: organization.subscriptionExpiresAt,
                    portalActivatedAt: organization.portalActivatedAt,
                })
                .from(organization)
                .where(eq(organization.id, ctx.tenant.organizationId))
                .limit(1)
                .then((rows) => rows[0]),
            trackingAllowance(ctx.db, ctx.tenant.organizationId),
        ]);

        // The gate resolved both rows a moment ago, so a miss here is a row
        // deleted mid-request rather than a case the UI has to render
        if (!account || !company) {
            throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
        }

        return {
            user: account,
            // The gate already narrowed the type to a partner one; the column
            // also admits Appload's own row, which is never a tenant
            organization: { ...company, type: ctx.tenant.orgType },
            role: ctx.tenant.role,
            level: ctx.tenant.level,
            actingOwner: ctx.tenant.actingOwner,
            permissions: [...ctx.tenant.permissions],
            modules: [...ctx.tenant.modules],
            modulesConfigured: ctx.tenant.modulesConfigured,
            plan: ctx.tenant.plan,
            allowance,
            tiers: TIERS,
        };
    }),

    /**
     * Which modules the company switches off — the real CEO's alone
     * (`ownerProcedure`): an acting CEO runs the company for a while, but
     * does not reshape it. The whole OFF list travels every time, so the
     * row is always exactly what the CEO last saw.
     */
    setModules: ownerProcedure
        .input(z.object({ disabled: DisabledModulesSchema }))
        .mutation(async ({ ctx, input }): Promise<{ organizationId: string; disabled: ModuleId[] }> => {
            const conflict = moduleConflict(ctx.tenant.orgType, input.disabled);

            if (conflict) throw new TRPCError({ code: "BAD_REQUEST", message: conflict });

            const disabled = [...new Set(input.disabled)];

            await ctx.db
                .update(organization)
                .set({ disabledModules: disabled })
                .where(eq(organization.id, ctx.tenant.organizationId));

            return { organizationId: ctx.tenant.organizationId, disabled };
        }),

    /**
     * The rail's badges in one small read. Each counts rows the page its
     * entry opens will show — the offers received inside My trucks ▸
     * Procurement, the turned-down loads inside the partners tab's
     * Procurement (the rail adds the two for its one Procurement badge),
     * each tab's disputes (added the same way), the incoming requests on
     * Partners — so a badge never promises a row the page does not have.
     *
     * Its own read, never the pages' stats: the rail mounts above every
     * page's hydration boundary, and a query it observed first would be
     * hydrated only after the page's server render had already asked for it
     * again — without the cookie. The brokerage counts are the same
     * predicates `orders.stats` counts with.
     */
    railCounts: tenantProcedure.query(async ({ ctx }): Promise<RailCounts> => {
        const tenantId = ctx.tenant.organizationId;
        const shipper = ctx.tenant.orgType === "shipper";
        const zero = sql<number>`0`.mapWith(Number);

        const [loads, disputes, connections, brokerage, proposals] = await Promise.all([
            ctx.db
                .select({
                    // The Procurement list's own predicate, so the badge is
                    // exactly what the page shows — Appload's requests included
                    received: sql<number>`count(*) filter (where ${received(tenantId)})::int`,
                    declined: sql<number>`count(*) filter (where ${movement.organizationId} = ${tenantId} and ${movement.status} = 'declined')::int`,
                })
                .from(movement)
                .where(or(
                    received(tenantId),
                    and(eq(movement.organizationId, tenantId), eq(movement.status, "declined")),
                ))
                .then((rows) => rows[0]),
            // The Disputes sections' own predicates, so each badge is its list
            ctx.db
                .select({
                    orders: sql<number>`count(*) filter (where ${sectionPredicate("orders", "disputes", tenantId)})::int`,
                    trips: sql<number>`count(*) filter (where ${sectionPredicate("trips", "disputes", tenantId)})::int`,
                })
                .from(movement)
                .where(visibleMovements(tenantId))
                .then((rows) => rows[0]),
            ctx.db
                .select({ incoming: sql<number>`count(*)::int` })
                .from(partnerConnection)
                .where(and(eq(partnerConnection.targetOrgId, tenantId), eq(partnerConnection.status, "pending")))
                .then((rows) => rows[0]),
            ctx.db
                .select({
                    toDispatch: shipper
                        ? zero
                        : conditionCount(and(eq(order.carrierId, tenantId), eq(order.status, "booked"), isNull(order.driverId))!),
                    offersToReview: shipper
                        ? conditionCount(and(eq(order.status, "prospect"), sql`${pendingOfferCount} > 0`)!)
                        : zero,
                })
                .from(order)
                .where(visibleOrders(tenantId, ctx.tenant.orgType))
                .then((rows) => rows[0]),
            // A multi-trip order a transporter drafted naming this company is a proposal until it answers
            ctx.db
                .select({ n: sql<number>`count(*)::int` })
                .from(contract)
                .where(and(eq(contract.clientOrgId, tenantId), eq(contract.status, "draft")))
                .then((rows) => rows[0]),
        ]);

        return {
            received: Number(loads?.received ?? 0),
            declined: Number(loads?.declined ?? 0),
            offersToReview: Number(brokerage?.offersToReview ?? 0),
            toDispatch: Number(brokerage?.toDispatch ?? 0),
            disputes: { orders: Number(disputes?.orders ?? 0), trips: Number(disputes?.trips ?? 0) },
            partners: Number(connections?.incoming ?? 0),
            proposals: Number(proposals?.n ?? 0),
        };
    }),

    /**
     * The company's own contact details and addresses. Owner and admin only
     * (the `organization: ["update"]` statement).
     *
     * Name and NUIT are deliberately absent: they are what Appload's registry,
     * the logbook and every issued document are keyed on, so a correction to
     * either is a staff edit in Admin, not a self-service one.
     */
    updateCompany: authorizedTenantProcedure("organization", ["update"])
        .input(UpdateCompanyBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ organizationId: string }> => {
            const values: Partial<typeof organization.$inferInsert> = {};

            if (input.email !== undefined) values.email = input.email.trim();
            if (input.phoneNumber !== undefined) values.phoneNumber = input.phoneNumber.trim();
            if (input.billingAddress !== undefined) values.billingAddress = toAddress(input.billingAddress);
            if (input.physicalAddress !== undefined) values.physicalAddress = toAddress(input.physicalAddress);

            if (Object.keys(values).length === 0) {
                return { organizationId: ctx.tenant.organizationId };
            }

            try {
                const [updated] = await ctx.db
                    .update(organization)
                    .set(values)
                    // The predicate is the gate's organization id, never an
                    // id from input
                    .where(eq(organization.id, ctx.tenant.organizationId))
                    .returning({ id: organization.id });

                if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                return { organizationId: updated.id };
            } catch (error) {
                if (error instanceof TRPCError) throw error;

                const constraint = uniqueViolationConstraint(error);

                if (constraint === null) throw error;
                if (constraint.includes("email")) {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                }
                if (constraint.includes("phone")) {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                }

                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }
        }),

    /**
     * A new password for the signed-in account. Routed through tRPC rather
     * than straight to `authClient` so the portal's mutations all log through
     * one door; the endpoint itself is Better Auth's, and its
     * `sensitiveSessionMiddleware` re-reads the session from the cookie with
     * the cache disabled — so the request headers must be forwarded.
     *
     * Better Auth's own `revokeOtherSessions` flag is deliberately not used:
     * it deletes *every* session, including this one, and hands back a
     * replacement cookie. That cookie would have to travel on a response
     * whose headers tRPC has already sent (the client batches over
     * `httpBatchStreamLink`, so the body streams while the procedure runs),
     * and losing it would sign the caller out of the browser they are
     * standing in. `/revoke-other-sessions` does the same job by keeping the
     * current token and dropping the rest — no new cookie, nothing to lose.
     */
    changePassword: tenantProcedure
        .input(ChangePasswordBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
            try {
                await ctx.authApi.changePassword({
                    body: {
                        currentPassword: input.currentPassword,
                        newPassword: input.newPassword,
                        revokeOtherSessions: false,
                    },
                    headers: ctx.headers,
                });
            } catch (error) {
                if (error instanceof APIError) {
                    // INVALID_PASSWORD is the overwhelmingly common one and
                    // the client puts it on the field; the rest (too short,
                    // no credential account) travel by the same route
                    const code = (error.body as { code?: string } | undefined)?.code ?? "CHANGE_PASSWORD_FAILED";

                    throw new TRPCError({ code: "BAD_REQUEST", message: code });
                }

                throw error;
            }

            if (input.revokeOtherSessions) {
                try {
                    await ctx.authApi.revokeOtherSessions({ headers: ctx.headers });
                } catch (error) {
                    // The password is already changed, which is what the
                    // caller came for; the other devices keep a session they
                    // can no longer re-create once it expires
                    console.error("[me.changePassword] revoking other sessions failed:", error);
                }
            }

            return { ok: true as const };
        }),

    /**
     * The company's door to Appload support (the trust wall, rls.ts): closed
     * unless an owner or admin opens it for a while, with a reason on
     * record. While it is open, staff read this company's own loads,
     * contracts and client list — the database lets them, nothing in app
     * code. Everyone on the company may read the record; opening and
     * closing take the organization's own permission.
     */
    /**
     * The company's own record: every action a member took in its name, and
     * every read Appload support made under a grant. Rows before the portal
     * stamped its tenant on them (2026-10) carry no company and do not show.
     */
    activity: createTRPCRouter({
        list: authorizedTenantProcedure("security", ["manage"])
            .input(z.object({ cursor: z.date().nullish(), limit: z.number().int().min(1).max(100).default(30) }))
            .query(async ({ ctx, input }) => {
                const rows = await ctx.db
                    .select({
                        id: activityLog.id,
                        action: activityLog.action,
                        app: activityLog.app,
                        // The sign-in hook has no name to snapshot; the user row fills it in
                        actorName: sql<string | null>`coalesce(${activityLog.actorName}, ${user.name})`,
                        entityType: activityLog.entityType,
                        entityId: activityLog.entityId,
                        status: activityLog.status,
                        createdAt: activityLog.createdAt,
                    })
                    .from(activityLog)
                    .leftJoin(user, eq(user.id, activityLog.actorId))
                    .where(and(
                        eq(activityLog.organizationId, ctx.tenant.organizationId),
                        // Heartbeats and read-marks are not what anybody opens this for
                        notInArray(activityLog.action, ["session.resumed", "notifications.markRead", "notifications.markAllRead", "threads.markRead"]),
                        input.cursor ? lt(activityLog.createdAt, input.cursor) : undefined,
                    ))
                    .orderBy(desc(activityLog.createdAt))
                    .limit(input.limit + 1);

                const page = rows.slice(0, input.limit);

                return {
                    items: page.map((row) => ({ ...row, support: row.app === "admin" })),
                    nextCursor: rows.length > input.limit ? page[page.length - 1]?.createdAt ?? null : null,
                };
            }),
    }),

    supportGrants: createTRPCRouter({
        list: tenantProcedure.query(async ({ ctx }) => {
            const tenantId = ctx.tenant.organizationId;
            const now = new Date();
            const [active, history] = await Promise.all([activeGrant(ctx.db, tenantId, now), grantHistory(ctx.db, tenantId)]);
            const names = new Map((await ctx.db
                .select({ id: user.id, name: user.name })
                .from(user)
                .where(inArray(user.id, [...new Set(history.map((row) => row.grantedBy).filter((id): id is string => id !== null))])))
                .map((row) => [row.id, row.name]));
            const view = (row: NonNullable<typeof active>) => ({
                id: row.id,
                reason: row.reason,
                grantedByName: row.grantedBy ? names.get(row.grantedBy) ?? null : null,
                createdAt: row.createdAt,
                expiresAt: row.expiresAt,
                revokedAt: row.revokedAt,
                state: row.revokedAt ? "revoked" as const : row.expiresAt > now ? "active" as const : "expired" as const,
            });

            return { active: active ? view(active) : null, history: history.map(view) };
        }),

        grant: authorizedTenantProcedure("security", ["manage"])
            .input(SupportGrantBaseSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await grantSupport(ctx.db, { organizationId: ctx.tenant.organizationId, userId: ctx.tenant.userId }, input);
                return { id: row.id, organizationId: row.organizationId, expiresAt: row.expiresAt };
            }),

        revoke: authorizedTenantProcedure("security", ["manage"])
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }) => {
                const row = await revokeSupport(ctx.db, { organizationId: ctx.tenant.organizationId, userId: ctx.tenant.userId }, input.id);
                return { id: row.id, organizationId: row.organizationId };
            }),
    }),
});
