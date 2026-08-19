import { after, NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { auth } from "@workspace/auth/server";
import { createTRPCContext } from "@workspace/trpc/init";

import { appRouter } from "@/backend/api/routers/_app";

/**
 * This wraps the `createTRPCContext` helper and provides the required context
 * for the tRPC API when handling an HTTP request (e.g. when you make requests
 * from Client Components).
 */
const createContext = async (request: NextRequest) => {
    return createTRPCContext({
        headers: request.headers,
        auth,
        // Keeps activity-log writes alive after the response is sent
        waitUntil: (promise) => after(promise),
    });
};

const handler = (request: NextRequest) =>
    fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: () => createContext(request),
        onError:
            process.env.NODE_ENV === "development"
                ? ({ path, error }) => {
                    console.error(`[TRPC] Error on ${path ?? "<no-path>"}: ${error.message}`);
                }
                : undefined,
    });

export { handler as GET, handler as POST };
