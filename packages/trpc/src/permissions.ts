import { TRPCError } from "@trpc/server";

import { isAuthorized, type Action, type Resource } from "@workspace/auth/user-permissions";

import { protectedProcedure } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";

/**
 * Staff-gated, permission-checked procedure. Extends `protectedProcedure`
 * with (a) the staff gate — only `user.type = "appload"` accounts may use
 * the admin API at all — and (b) an access-control check of the given
 * resource actions against the actor's platform role, read live from the
 * database. The resolved gates land on `ctx.staff` for role-dependent
 * logic inside the procedure (e.g. admin-only terminal reversals).
 */
export const authorizedProcedure = <R extends Resource>(
    resource: R,
    actions: Action<R>[],
) =>
    protectedProcedure.use(async ({ ctx, next }) => {
        const staff = await getStaffGates(ctx.db, { userId: ctx.session.user.id });

        if (!staff.isStaff || !isAuthorized(staff.role, resource, actions)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
        }

        return next({ ctx: { ...ctx, staff } });
    });
