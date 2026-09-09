import { TRPCClientError } from "@trpc/client";

/**
 * tRPC procedures carry domain error codes in the error message
 * (e.g. "DUPLICATE_NUIT", "INSUFFICIENT_SCOPE"). Extracts the code and
 * narrows it to the codes a call site knows how to display.
 */
export function domainErrorCode<T extends string>(
    error: unknown,
    known: readonly T[],
    fallback: T,
): T {
    if (error instanceof TRPCClientError) {
        const message = error.message as T;

        return known.includes(message) ? message : fallback;
    }

    return fallback;
}
