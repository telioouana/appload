"use client";

import superjson from "superjson";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { createTRPCClient, httpBatchStreamLink, loggerLink, } from "@trpc/client";

import type { QueryClient } from "@tanstack/react-query";

import type { AppRouter } from "./routers/_app";
import { createQueryClient } from "@workspace/trpc/query-client";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
    if (typeof window === "undefined") {
        // Server: always make a new query client
        return createQueryClient();
    } else {
        // Browser: use singleton pattern to keep the same query client
        return (clientQueryClientSingleton ??= createQueryClient());
    }
};

// Explicit annotations: the inferred router type is too large for the
// compiler to serialize in declaration files (TS7056)
type TRPCContext = ReturnType<typeof createTRPCContext<AppRouter>>;

const trpcContext: TRPCContext = createTRPCContext<AppRouter>();

export const useTRPC: TRPCContext["useTRPC"] = trpcContext.useTRPC;
export const TRPCProvider: TRPCContext["TRPCProvider"] = trpcContext.TRPCProvider;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
    const queryClient = getQueryClient();

    const [trpcClient] = useState(() =>
        createTRPCClient<AppRouter>({
            links: [
                loggerLink({
                    enabled: (op) =>
                        process.env.NODE_ENV === "development" ||
                        (op.direction === "down" && op.result instanceof Error),
                }),
                httpBatchStreamLink({
                    transformer: superjson,
                    url: getBaseUrl() + "/api/trpc",
                    headers() {
                        const headers = new Headers();
                        headers.set("x-trpc-source", "nextjs-react");
                        return headers;
                    },
                }),
            ],
        }),
    );

    return (
        <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
                {props.children}
            </TRPCProvider>
        </QueryClientProvider>
    );
}

const getBaseUrl = () => {
    if (typeof window !== "undefined") return window.location.origin;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
     
    return `http://localhost:${process.env.PORT ?? 3000}`;
};