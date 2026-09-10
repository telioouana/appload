import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import { organization, user } from "@workspace/db/users";
import { AddressSchema, type Address } from "@workspace/db/types";

import {
    PLAN_QUOTA,
    SUBSCRIPTION_PLAN,
    trackingAllowance,
    type SubscriptionPlan,
    type TrackingAllowance,
} from "@workspace/domain/subscription";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";
import type { OrgStatus, OrgType, TenantPlan, TenantRole } from "@workspace/trpc/tenant-gate";

import { ChangePasswordBaseSchema } from "@/backend/schemas/settings";
import { UpdateCompanyBaseSchema } from "@/backend/schemas/company";

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
    role: TenantRole;
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
        { code?: string; constraint?: string; detail?: string } | undefined
    >;

    for (const candidate of candidates) {
        if (candidate?.code === "23505") {
            return candidate.constraint ?? candidate.detail ?? "";
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
            organization: company,
            role: ctx.tenant.role,
            plan: ctx.tenant.plan,
            allowance,
            tiers: TIERS,
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
});
