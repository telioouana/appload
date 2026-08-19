import superjson from "superjson";
import { z, ZodError } from "zod";
import { initTRPC, TRPCError } from "@trpc/server";

import { db } from "@workspace/db/db";
import { Auth } from "@workspace/auth/server";

import { recordRequestActivity } from "@workspace/trpc/activity-log";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: {
    headers: Headers,
    auth: Auth,
    // Serverless-safe scheduler for post-response work (e.g. Next's `after`).
    // Without it, fire-and-forget promises can be frozen once the response
    // is sent and activity-log rows silently lost.
    waitUntil?: (promise: Promise<unknown>) => void,
}) => {
    const authApi = opts.auth.api
    const session = await authApi.getSession({ headers: opts.headers })

    return {
        authApi,
        session,
        db,
        // Request headers, forwarded to auth APIs that need them
        // (e.g. authApi.getAccessToken)
        headers: opts.headers,
        waitUntil: opts.waitUntil,
    };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC
    .context<Awaited<ReturnType<typeof createTRPCContext>>>()
    .create({
        /**
         * @see https://trpc.io/docs/server/data-transformers
         */
        transformer: superjson,
        errorFormatter: ({ shape, error }) => ({
            ...shape,
            data: {
                ...shape.data,
                zodError:
                    error.cause instanceof ZodError
                        ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
                        : null,
            },
        }),
    });

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an articifial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
    const start = Date.now();

    if (t._config.isDev) {
        // artificial delay in dev 100-500ms
        const waitMs = Math.floor(Math.random() * 400) + 100;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const result = await next();

    if (t._config.isDev) {
        const end = Date.now();
        console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
    }

    return result;
});

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(timingMiddleware);
export const createCallerFactory = t.createCallerFactory;

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
    .use(timingMiddleware)
    .use(({ ctx, next }) => {
        if (!ctx.session?.user) {
            throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return next({
            ctx: {
                // infers the `session` as non-nullable
                session: { ...ctx.session, user: ctx.session.user },
            },
        });
    })
    .use(async ({ ctx, next, path, type, getRawInput }) => {
        // Raw input (post-superjson, pre-zod) is only needed for mutation
        // log rows; queries just feed the session-resume heartbeat
        const rawInput = type === "mutation" ? await getRawInput() : undefined;

        const result = await next();

        // Fire-and-forget: never blocks the response, and a logging failure
        // never turns into a request failure
        const pending = recordRequestActivity({
            session: ctx.session,
            path,
            type,
            rawInput,
            ok: result.ok,
            output: result.ok ? result.data : undefined,
            errorCode: result.ok ? undefined : result.error.code,
            errorMessage: result.ok ? undefined : result.error.message,
        }).catch((error: unknown) => console.error("[activity-log]", path, error));

        if (ctx.waitUntil) ctx.waitUntil(pending);

        return result;
    });