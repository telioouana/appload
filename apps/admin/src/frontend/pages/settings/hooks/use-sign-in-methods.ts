"use client"

import { useQuery } from "@tanstack/react-query"

import { authClient } from "@workspace/auth/client"

// Shared so the view and the card resolve to one request, and so an unlink or
// a new password invalidates both
export const SIGN_IN_METHODS_KEY = ["auth", "accounts"] as const

/**
 * `/list-accounts` runs `parseAccountOutput`, which strips the password hash
 * and every token before serialising — the shape below is all that crosses
 * the wire, so deriving "has a password" from `providerId` leaks nothing.
 */
export type LinkedAccount = {
    id: string
    accountId: string
    userId: string
    providerId: string
    createdAt: Date
    updatedAt: Date
    scopes: string[]
}

/**
 * Better Auth exposes no reactive atom for accounts — only `useSession` — so
 * this is a plain query. `QueryClientProvider` is already mounted for this
 * route by the root layout.
 */
export function useSignInMethods() {
    const query = useQuery({
        queryKey: SIGN_IN_METHODS_KEY,
        queryFn: async (): Promise<LinkedAccount[]> => {
            const { data, error } = await authClient.listAccounts()

            if (error) throw new Error(error.code ?? error.message ?? "LIST_ACCOUNTS_FAILED")

            return (data ?? []) as LinkedAccount[]
        },
    })

    const accounts = query.data ?? []
    const credential = accounts.find((account) => account.providerId === "credential") ?? null
    const google = accounts.find((account) => account.providerId === "google") ?? null

    return {
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
        accounts,
        credential,
        google,
        hasPassword: Boolean(credential),
        hasGoogle: Boolean(google),
        // Better Auth refuses to delete the last row
        // (FAILED_TO_UNLINK_LAST_ACCOUNT), so the button can say so before the
        // round trip rather than after it
        canUnlink: accounts.length > 1,
    }
}
