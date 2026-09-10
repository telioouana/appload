import { z } from "zod";
import { APIError } from "better-auth/api";
import { and, eq, or, sql } from "drizzle-orm";

import type { Auth } from "@workspace/auth/server";
import type { db as Database } from "@workspace/db/db";
import type { Address } from "@workspace/db/types";
import { invitation, member, organization, rateLimit, user } from "@workspace/db/users";
import { organizationClaim, partnerConnection } from "@workspace/db/connections";
import { notificationCursor } from "@workspace/db/notifications";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "@workspace/trpc/init";
import { onboardingProcedure } from "@workspace/trpc/tenant";
import { brandedEmail, sendEmail } from "@workspace/auth/email";

import { SignUpBaseSchema } from "@/backend/schemas/sign-up";
import { CreateCompanyBaseSchema, NUIT_RE } from "@/frontend/pages/onboarding/types";

export type OrgType = "shipper" | "carrier";

export type InvitationInfo = {
    email: string;
    organizationName: string;
    organizationType: OrgType;
    status: string;
    expired: boolean;
};

export type NuitLookup = {
    organization: {
        id: string;
        name: string;
        type: OrgType;
        province: string | null;
        kycStatus: string;
    } | null;
    hasMembers: boolean;
    /** The caller's verified address is the organization's registered one */
    emailMatches: boolean;
};

export type OnboardingStatus = {
    user: { id: string; name: string; email: string; type: OrgType; emailVerified: boolean };
    hasMembership: boolean;
    pendingClaim: { organizationName: string; createdAt: Date } | null;
};

const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

/**
 * The violated constraint name when the error (or its cause) is a postgres
 * unique violation (23505), else null — how duplicates become domain codes.
 */
function uniqueViolationConstraint(error: unknown): string | null {
    const candidates = [error, (error as { cause?: unknown })?.cause] as Array<
        { code?: string; constraint?: string; detail?: string } | undefined
    >;

    for (const candidate of candidates) {
        if (candidate?.code === "23505") {
            return candidate.constraint ?? candidate.detail ?? "";
        }
    }

    return null;
}

/** A blank address is stored as null rather than four empty strings. */
function toAddress(value: Partial<Address> | undefined): Address | null {
    if (!value?.address || !value.placeId || !value.country || !value.state) return null;

    return {
        address: value.address,
        placeId: value.placeId,
        country: value.country,
        state: value.state,
    };
}

const lower = (value: string) => value.trim().toLowerCase();

/**
 * The caller's address, or null when the platform did not say. Vercel sets
 * `x-forwarded-for` on every request; the dev server does not, and lumping
 * every local caller into one bucket would rate-limit testing rather than
 * anybody real.
 */
function clientIp(headers: Headers): string | null {
    return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * Counts one attempt against `key`, and answers whether it is allowed.
 *
 * Better Auth's own limiter wraps requests to /api/auth only, so a procedure
 * that calls `signUpEmail`/`sendVerificationEmail` server-side from /api/trpc
 * passes none of it — and `signUp` is public. Counters live in the same
 * `rate_limit` table (Better Auth's own keys are `<ip><path>`, so the prefix
 * here cannot collide). Read-then-write is not atomic on neon-http; a burst
 * can overshoot by a request or two, which is immaterial at these limits.
 */
async function withinRateLimit(
    db: typeof Database,
    params: { key: string; windowMs: number; max: number },
): Promise<boolean> {
    const now = Date.now();

    const [current] = await db
        .select({ count: rateLimit.count, lastRequest: rateLimit.lastRequest })
        .from(rateLimit)
        .where(eq(rateLimit.id, params.key))
        .limit(1);

    const inWindow =
        current?.lastRequest != null && now - current.lastRequest < params.windowMs;

    if (inWindow && (current?.count ?? 0) >= params.max) return false;

    await db
        .insert(rateLimit)
        .values({ id: params.key, key: params.key, count: 1, lastRequest: now })
        .onConflictDoUpdate({
            target: rateLimit.id,
            set: {
                count: inWindow ? sql`${rateLimit.count} + 1` : 1,
                lastRequest: now,
            },
        });

    return true;
}

/**
 * Membership plus the two side effects that make an organization a portal
 * tenant: the activation stamp, and the notification cursor that tells the
 * feed builder where this tenant's history starts (so joining does not
 * deliver years of past events).
 *
 * neon-http has no transactions: `addMember` first, because it is the write
 * that can legitimately fail (a second membership, `organizationLimit` 1),
 * and the caller compensates for it. The two writes after it are idempotent.
 */
async function activateMembership(
    ctx: { db: typeof Database; authApi: Auth["api"] },
    params: { userId: string; organizationId: string },
) {
    await ctx.authApi.addMember({
        body: {
            userId: params.userId,
            organizationId: params.organizationId,
            role: "owner",
        },
    });

    const now = new Date();

    await ctx.db
        .update(organization)
        .set({ portalActivatedAt: now })
        .where(eq(organization.id, params.organizationId));

    await ctx.db
        .insert(notificationCursor)
        .values({ organizationId: params.organizationId, lastHistoryCreatedAt: now })
        .onConflictDoNothing();
}

export const onboardingRouter = createTRPCRouter({
    /**
     * The portal's only door into account creation. `POST
     * /api/auth/sign-up/email` is blocked by the route handler, so `type` —
     * what the tenant gate reads — is never client-chosen: it comes from the
     * declared company type, or from the inviting organization when an
     * invitation is in hand.
     */
    signUp: publicProcedure
        .input(SignUpBaseSchema.extend({ invitationId: z.string().optional() }))
        .mutation(async ({ ctx, input }): Promise<{ email: string }> => {
            // Unbounded, this mutation writes user rows and sends one Resend
            // mail per address for anyone who loops it — and squats an address
            // its real owner has not signed up with yet
            const ip = clientIp(ctx.headers);

            const allowed =
                (ip === null || await withinRateLimit(ctx.db, {
                    key: `portal-signup:ip:${ip}`,
                    windowMs: 60 * 60 * 1000,
                    max: 5,
                })) &&
                await withinRateLimit(ctx.db, {
                    key: `portal-signup:email:${lower(input.email)}`,
                    windowMs: 24 * 60 * 60 * 1000,
                    max: 3,
                });

            if (!allowed) {
                throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
            }

            let type: OrgType = input.companyType;

            if (input.invitationId) {
                const [invited] = await ctx.db
                    .select({
                        email: invitation.email,
                        status: invitation.status,
                        expiresAt: invitation.expiresAt,
                        orgType: organization.type,
                    })
                    .from(invitation)
                    .innerJoin(organization, eq(organization.id, invitation.organizationId))
                    .where(eq(invitation.id, input.invitationId))
                    .limit(1);

                if (
                    !invited ||
                    invited.status !== "pending" ||
                    invited.expiresAt <= new Date() ||
                    lower(invited.email) !== lower(input.email)
                ) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_INVITATION" });
                }

                // The invited company decides the account type: an invitee
                // cannot join a carrier as a shipper
                type = invited.orgType;
            }

            try {
                await ctx.authApi.signUpEmail({
                    body: {
                        email: input.email,
                        password: input.password,
                        name: input.name,
                        type,
                    },
                });
            } catch (error) {
                if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS") {
                    throw new TRPCError({ code: "CONFLICT", message: "EMAIL_TAKEN" });
                }

                throw error;
            }

            // `autoSignIn` is off, so nothing is signed in yet: the link in
            // this email is what signs the account in (autoSignInAfterVerification)
            // and lands it where the account has to go next. An invitee must
            // come back to the invitation: `organizationLimit` is 1, so a
            // company registered from the onboarding step would leave the
            // pending invitation impossible to accept, for good
            await ctx.authApi.sendVerificationEmail({
                body: {
                    email: input.email,
                    callbackURL: input.invitationId
                        ? `/accept-invitation/${input.invitationId}`
                        : "/onboarding",
                },
            });

            return { email: input.email };
        }),

    /**
     * What the accept-invitation page shows before anyone is signed in:
     * enough to name the company and pre-fill the address it was sent to,
     * and nothing else about either.
     */
    invitation: publicProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<InvitationInfo> => {
            const [row] = await ctx.db
                .select({
                    email: invitation.email,
                    status: invitation.status,
                    expiresAt: invitation.expiresAt,
                    organizationName: organization.name,
                    organizationType: organization.type,
                })
                .from(invitation)
                .innerJoin(organization, eq(organization.id, invitation.organizationId))
                .where(eq(invitation.id, input.id))
                .limit(1);

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            return {
                email: row.email,
                organizationName: row.organizationName,
                organizationType: row.organizationType,
                status: row.status,
                expired: row.expiresAt <= new Date(),
            };
        }),

    /** Where the onboarding screen starts: who the caller is and what is pending for them. */
    status: onboardingProcedure.query(async ({ ctx }): Promise<OnboardingStatus> => {
        const [account] = await ctx.db
            .select({
                id: user.id,
                name: user.name,
                email: user.email,
                type: user.type,
                emailVerified: user.emailVerified,
            })
            .from(user)
            .where(eq(user.id, ctx.session.user.id))
            .limit(1);

        // The gate already rejected staff and driver accounts, so the type
        // narrowing below only restates what it guaranteed
        if (!account || (account.type !== "shipper" && account.type !== "carrier")) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NOT_PARTNER_ACCOUNT" });
        }

        const [claim] = await ctx.db
            .select({
                organizationName: organization.name,
                createdAt: organizationClaim.createdAt,
            })
            .from(organizationClaim)
            .innerJoin(organization, eq(organization.id, organizationClaim.organizationId))
            .where(and(
                eq(organizationClaim.userId, ctx.session.user.id),
                eq(organizationClaim.status, "pending"),
            ))
            .limit(1);

        return {
            user: {
                id: account.id,
                name: account.name,
                email: account.email,
                type: account.type,
                emailVerified: account.emailVerified,
            },
            hasMembership: ctx.tenant.organizationId !== null,
            pendingClaim: claim ?? null,
        };
    }),

    /**
     * The one lookup the whole screen turns on. Every company Appload loaded
     * from the logbook is already here with no members, so a NUIT match is
     * the common case — and what it answers decides between claiming and
     * registering. Deliberately narrow: no email, phone or address of a
     * company the caller has not been let into.
     */
    lookupNuit: onboardingProcedure
        .input(z.object({ nuit: z.string().regex(NUIT_RE) }))
        .query(async ({ ctx, input }): Promise<NuitLookup> => {
            const [found] = await ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    email: organization.email,
                    physicalAddress: organization.physicalAddress,
                    kycStatus: organization.kycStatus,
                    status: organization.status,
                })
                .from(organization)
                .where(eq(organization.nuit, input.nuit))
                .limit(1);

            if (!found || found.status === "closed") {
                return { organization: null, hasMembers: false, emailMatches: false };
            }

            const [members] = await ctx.db
                .select({ count: sql<number>`count(*)::int` })
                .from(member)
                .where(eq(member.organizationId, found.id));

            return {
                organization: {
                    id: found.id,
                    name: found.name,
                    type: found.type,
                    province: found.physicalAddress?.state ?? null,
                    kycStatus: found.kycStatus,
                },
                hasMembers: (members?.count ?? 0) > 0,
                emailMatches: lower(found.email) === lower(ctx.session.user.email),
            };
        }),

    /**
     * Registers a company nobody had in the database yet and makes the
     * caller its owner. A direct insert rather than Better Auth's
     * `organization.create`: `allowUserToCreateOrganization` is false, and
     * the row carries columns (NUIT, type, status, addresses) the plugin
     * knows nothing about.
     */
    createOrganization: onboardingProcedure
        .input(CreateCompanyBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ organizationId: string }> => {
            // The email gate is the procedure's own (it throws on
            // EMAIL_UNVERIFIED); only the membership one is left open here
            if (ctx.tenant.organizationId) {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_MEMBER" });
            }

            const [account] = await ctx.db
                .select({ type: user.type, email: user.email })
                .from(user)
                .where(eq(user.id, ctx.session.user.id))
                .limit(1);

            if (!account || (account.type !== "shipper" && account.type !== "carrier")) {
                throw new TRPCError({ code: "FORBIDDEN", message: "NOT_PARTNER_ACCOUNT" });
            }

            const slug = slugify(input.name) || "organization";
            // The owner's own verified address stands in when the form left
            // the company one empty — the column is not nullable, and this
            // is the address Appload already writes to
            const email = input.email?.trim() || account.email;

            let organizationId: string | null = null;

            for (let attempt = 0; attempt < 2 && organizationId === null; attempt++) {
                try {
                    const [created] = await ctx.db
                        .insert(organization)
                        .values({
                            id: crypto.randomUUID(),
                            name: input.name,
                            // Retry once with a random suffix on slug collision
                            slug: attempt === 0 ? slug : `${slug}-${crypto.randomUUID().slice(0, 4)}`,
                            nuit: input.nuit,
                            email,
                            phoneNumber: input.phone,
                            billingAddress: toAddress(input.billingAddress),
                            physicalAddress: toAddress(input.physicalAddress),
                            type: account.type,
                            status: "pending",
                            metadata: JSON.stringify({ registeredVia: "portal" }),
                            createdAt: new Date(),
                        })
                        .returning({ id: organization.id });

                    if (!created) {
                        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                    }

                    organizationId = created.id;
                } catch (error) {
                    const constraint = uniqueViolationConstraint(error);

                    if (constraint === null) throw error;

                    if (constraint.includes("nuit")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_NUIT" });
                    }
                    if (constraint.includes("email")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                    }
                    if (constraint.includes("phone")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                    }
                    if (constraint.includes("slug") && attempt === 0) {
                        continue;
                    }

                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }
            }

            if (organizationId === null) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            try {
                await activateMembership(ctx, { userId: ctx.session.user.id, organizationId });
            } catch (error) {
                // Compensation: without an owner the row is an orphan the
                // caller could never reach again, and its NUIT would block
                // the retry
                await ctx.db.delete(organization).where(eq(organization.id, organizationId)).catch(() => undefined);

                throw error instanceof TRPCError
                    ? error
                    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
            }

            return { organizationId };
        }),

    /**
     * Asks to own a company that is already in the database but has nobody
     * on the portal. Auto-approved only when the caller's verified address
     * is the one Appload already has on file for it — placeholder addresses
     * (`missing-…@appload.invalid`) never match, so a claim on one always
     * goes to ops.
     */
    claim: onboardingProcedure
        .input(z.object({ organizationId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ approved: boolean }> => {
            if (ctx.tenant.organizationId) {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_MEMBER" });
            }

            const [target] = await ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    email: organization.email,
                    status: organization.status,
                })
                .from(organization)
                .where(eq(organization.id, input.organizationId))
                .limit(1);

            if (!target || target.status === "closed") {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const [members] = await ctx.db
                .select({ count: sql<number>`count(*)::int` })
                .from(member)
                .where(eq(member.organizationId, target.id));

            if ((members?.count ?? 0) > 0) {
                throw new TRPCError({ code: "CONFLICT", message: "ORGANIZATION_HAS_MEMBERS" });
            }

            const [pending] = await ctx.db
                .select({ id: organizationClaim.id })
                .from(organizationClaim)
                .where(and(
                    eq(organizationClaim.userId, ctx.session.user.id),
                    eq(organizationClaim.status, "pending"),
                ))
                .limit(1);

            if (pending) {
                throw new TRPCError({ code: "CONFLICT", message: "CLAIM_PENDING" });
            }

            const [account] = await ctx.db
                .select({ name: user.name, email: user.email })
                .from(user)
                .where(eq(user.id, ctx.session.user.id))
                .limit(1);

            if (!account) {
                throw new TRPCError({ code: "FORBIDDEN", message: "NOT_PARTNER_ACCOUNT" });
            }

            // Defence in depth: a company another partner registered from the
            // portal carries a caller-chosen contact and a placeholder email.
            // Even if some future writer stored a real address on such a row,
            // nobody walks into it unreviewed — ops decide those claims.
            const [registeredByPartner] = await ctx.db
                .select({ id: partnerConnection.id })
                .from(partnerConnection)
                .where(and(
                    or(
                        eq(partnerConnection.requesterOrgId, target.id),
                        eq(partnerConnection.targetOrgId, target.id),
                    ),
                    eq(partnerConnection.acceptedVia, "registration"),
                ))
                .limit(1);

            const autoApproved =
                registeredByPartner === undefined && lower(target.email) === lower(account.email);

            if (autoApproved) {
                await activateMembership(ctx, {
                    userId: ctx.session.user.id,
                    organizationId: target.id,
                });

                // Written after the fact, and only for the record: an
                // approval nobody had to decide still has to be explainable
                await ctx.db.insert(organizationClaim).values({
                    organizationId: target.id,
                    userId: ctx.session.user.id,
                    status: "approved",
                    autoApproved: true,
                    decidedAt: new Date(),
                });

                return { approved: true };
            }

            try {
                await ctx.db.insert(organizationClaim).values({
                    organizationId: target.id,
                    userId: ctx.session.user.id,
                    status: "pending",
                });
            } catch (error) {
                // The partial unique index: somebody else has an open claim
                // on this company
                if (uniqueViolationConstraint(error) !== null) {
                    throw new TRPCError({ code: "CONFLICT", message: "CLAIM_PENDING" });
                }

                throw error;
            }

            const ops = process.env.OPS_NOTIFICATION_EMAIL;

            if (ops) {
                const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${target.type === "carrier" ? "carriers/all" : "shippers"}`;

                const result = await sendEmail({
                    to: [ops],
                    subject: `Pedido de acesso ao portal: ${target.name}`,
                    html: brandedEmail({
                        locale: "pt",
                        title: "Novo pedido de acesso ao portal",
                        lines: [
                            `${account.name} (${account.email}) pediu para ser responsável da empresa <strong>${target.name}</strong>.`,
                            "O email da conta não corresponde ao email registado da empresa, por isso o pedido fica à espera de decisão.",
                        ],
                        ctaLabel: "Abrir no Admin",
                        ctaUrl: adminUrl,
                        disclaimer: "Este email é enviado automaticamente pelo portal de parceiros.",
                    }),
                });

                if (!result.ok) {
                    // The claim row is what ops works from; the email is the
                    // nudge, so a provider failure must not undo the request
                    console.error("[onboarding] claim notification failed:", result.error);
                }
            } else {
                console.warn("[onboarding] OPS_NOTIFICATION_EMAIL not set — claim raised without notification");
            }

            return { approved: false };
        }),
});
