import { cache } from "react";
import { headers } from "next/headers";
import { after } from "next/server";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import type { TRPCOptionsProxy, TRPCQueryOptions } from "@trpc/tanstack-react-query";

import { auth } from "@workspace/auth/server";
import { createTRPCContext } from "@workspace/trpc/init"
import { createQueryClient }  from "@workspace/trpc/query-client"

import { appRouter, type AppRouter } from "./routers/_app";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
    const heads = new Headers(await headers());
    heads.set("x-trpc-source", "rsc");

    return createTRPCContext({
        headers: heads,
        auth,
        // Keeps activity-log writes alive after the response is sent
        waitUntil: (promise) => after(promise),
    });
});

const getQueryClient = cache(createQueryClient);

// Explicit annotation: the inferred router type is too large for the
// compiler to serialize in declaration files (TS7056)
export const trpc: TRPCOptionsProxy<AppRouter> = createTRPCOptionsProxy<AppRouter>({
    router: appRouter,
    ctx: createContext,
    queryClient: getQueryClient,
});

export function HydrateClient(props: { children: React.ReactNode }) {
    const queryClient = getQueryClient();
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            {props.children}
        </HydrationBoundary>
    );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
    queryOptions: T,
) {
    const queryClient = getQueryClient();
    if (queryOptions.queryKey[1]?.type === "infinite") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void queryClient.prefetchInfiniteQuery(queryOptions as any);
    } else {
        void queryClient.prefetchQuery(queryOptions);
    }
}