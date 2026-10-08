import { experimental_standaloneMiddleware, TRPCError } from "@trpc/server";

import {
    isOrgAuthorized,
    type OrgAction,
    type OrgResource,
} from "@workspace/auth/organization-permissions";
import type { ModuleId } from "@workspace/auth/organization-modules";

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
 * against the member's live permissions (profile defaults plus their own
 * changes, resolved by the gate). UI gating alone can be bypassed via
 * the API, so the statements are enforced here.
 */
export const authorizedTenantProcedure = <R extends OrgResource>(
    resource: R,
    actions: OrgAction<R>[],
) =>
    tenantProcedure.use(({ ctx, next }) => {
        if (!isOrgAuthorized(ctx.tenant.permissions, resource, actions)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
        }
        return next();
    });

/**
 * The company switched this module off: the door that would create rows in
 * it stays shut. Reads and the receiving side never call this — switching a
 * module off hides its entry points, never its data.
 */
export const assertModule = (tenant: { modules: ReadonlySet<ModuleId> }, id: ModuleId): void => {
    if (!tenant.modules.has(id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "MODULE_DISABLED" });
    }
};

/** Middleware form of `assertModule`, to chain onto any tenant builder: `.use(withModule(id))`. */
export const withModule = (id: ModuleId) =>
    experimental_standaloneMiddleware<{ ctx: { tenant: { modules: ReadonlySet<ModuleId> } } }>().create(
        ({ ctx, next }) => {
            assertModule(ctx.tenant, id);
            return next();
        },
    );

/** Whole-procedure form of `assertModule`, for a door that is all one module's. */
export const requireModule = (id: ModuleId) => tenantProcedure.use(withModule(id));

/**
 * The real CEO only. An acting CEO keeps their own profile (`role` is never
 * "owner" for them), so the first test already leaves them out; the second
 * says so for the reader.
 */
export const ownerProcedure = tenantProcedure.use(({ ctx, next }) => {
    if (ctx.tenant.role !== "owner" || ctx.tenant.actingOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
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
