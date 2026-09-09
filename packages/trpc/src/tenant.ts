import { TRPCError } from "@trpc/server";

import {
    isOrgAuthorized,
    type OrgAction,
    type OrgResource,
} from "@workspace/auth/organization-permissions";

import { protectedProcedure } from "@workspace/trpc/init";

/**
 * Tenant-gated procedure. Extends `protectedProcedure` with the tenant gate —
 * a partner account, a verified email and a live membership in an open
 * organization, all read from the database rather than the session cookie.
 * The resolved gates land on `ctx.tenant` (organization id, type, role and
 * subscription plan) for every scoped query inside the procedure.
 */
export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const tenant = await ctx.tenantGates(ctx.session.user.id);

    if (!tenant.ok) {
        throw new TRPCError({ code: "FORBIDDEN", message: tenant.reason });
    }

    return next({ ctx: { ...ctx, tenant } });
});

/** Carrier-only procedure (fleet, trips, offers on requests). */
export const carrierProcedure = tenantProcedure.use(({ ctx, next }) => {
    if (ctx.tenant.orgType !== "carrier") {
        throw new TRPCError({ code: "FORBIDDEN", message: "WRONG_ORGANIZATION_TYPE" });
    }
    return next();
});

/** Shipper-only procedure (order requests, quote decisions). */
export const shipperProcedure = tenantProcedure.use(({ ctx, next }) => {
    if (ctx.tenant.orgType !== "shipper") {
        throw new TRPCError({ code: "FORBIDDEN", message: "WRONG_ORGANIZATION_TYPE" });
    }
    return next();
});

/**
 * Tenant procedure with an access-control check of the given resource actions
 * against the member's organization role. UI gating alone can be bypassed via
 * the API, so the statements are enforced here.
 */
export const authorizedTenantProcedure = <R extends OrgResource>(
    resource: R,
    actions: OrgAction<R>[],
) =>
    tenantProcedure.use(({ ctx, next }) => {
        if (!isOrgAuthorized(ctx.tenant.role, resource, actions)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
        }
        return next();
    });

/**
 * Paid-plan procedure: the role statements plus a live subscription. The plan
 * is read with the rest of the gate, so an expired subscription closes the
 * screen on the next request, not on the next sign-in.
 */
export const proProcedure = <R extends OrgResource>(
    resource: R,
    actions: OrgAction<R>[],
) =>
    authorizedTenantProcedure(resource, actions).use(({ ctx, next }) => {
        if (!ctx.tenant.plan.isPro) {
            throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_REQUIRED" });
        }
        return next();
    });

/**
 * Pre-membership procedure: a partner account that is not banned and has a
 * verified email, with no organization required. This is what registers or
 * claims one, so it exposes the (not-ok) gate result on `ctx.tenant` instead
 * of throwing on it.
 *
 * Only the membership gate is left open. The email one is not: sign-in does
 * not require verification, and what this procedure carries writes to the
 * partner registry — an unverified account could otherwise squat a real
 * company's NUIT or queue a claim against it.
 */
export const onboardingProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const tenant = await ctx.tenantGates(ctx.session.user.id);

    if (
        tenant.reason === "NOT_PARTNER_ACCOUNT" ||
        tenant.reason === "BANNED" ||
        tenant.reason === "EMAIL_UNVERIFIED"
    ) {
        throw new TRPCError({ code: "FORBIDDEN", message: tenant.reason });
    }

    return next({ ctx: { ...ctx, tenant } });
});
