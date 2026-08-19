import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import { createTRPCRouter, protectedProcedure } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";

/**
 * Self-service: the actor is always the session user. Deliberately not
 * `authorizedProcedure`. The statement that covers passwords is
 * `user: ["set-password"]`, which only the `admin` role carries — that is the
 * permission to set *someone else's* password. Acting on your own account
 * needs the staff gate and nothing beyond it.
 */
const selfProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const staff = await getStaffGates(ctx.db, { userId: ctx.session.user.id });

    if (!staff.isStaff) throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });

    return next({ ctx: { ...ctx, staff } });
});

export const settingsRouter = createTRPCRouter({
    /**
     * The first password for an account that has only ever signed in with
     * Google.
     *
     * `setPassword` is declared `createAuthEndpoint.serverOnly(...)` in
     * better-auth 1.6.23 — it is never mounted on /api/auth and `authClient`
     * has no method for it, so a trusted server caller is the only route.
     * It creates the missing `credential` account row itself and throws
     * PASSWORD_ALREADY_SET if one exists, so there is nothing to pre-check.
     *
     * The `requestPasswordReset` email flow also exists (the sign-in page's
     * forgot-password link), but for a signed-in user setting a first
     * password inline beats a round trip through the inbox.
     */
    setPassword: selfProcedure
        // Matches Better Auth's own default bounds; if
        // `emailAndPassword.minPasswordLength` is ever configured, this has to
        // move with it or the client-side message becomes a lie
        .input(z.object({ newPassword: z.string().min(8).max(128) }))
        .mutation(async ({ ctx, input }) => {
            try {
                await ctx.authApi.setPassword({
                    body: { newPassword: input.newPassword },
                    // `sensitiveSessionMiddleware` re-reads the session from
                    // the cookie with the cache disabled, so the request
                    // headers must be forwarded — ctx.session is not enough
                    headers: ctx.headers,
                });
            } catch (error) {
                if (error instanceof APIError) {
                    const code = (error.body as { code?: string } | undefined)?.code ?? "SET_PASSWORD_FAILED";

                    throw new TRPCError({
                        code: code === "PASSWORD_ALREADY_SET" ? "CONFLICT" : "BAD_REQUEST",
                        message: code,
                    });
                }

                throw error;
            }

            return { ok: true as const };
        }),
});
