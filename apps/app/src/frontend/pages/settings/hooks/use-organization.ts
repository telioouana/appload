"use client"

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@workspace/auth/client";

/**
 * Invitations come straight from Better Auth's organization plugin, held to
 * the team rules by its invitation hooks (packages/auth server.ts); the
 * members themselves are the team router's (settings/server/team.ts). The endpoint
 * defaults to the session cookie's `activeOrganizationId`, which the portal
 * never trusts for tenancy (it is stale for up to five minutes after a
 * membership changes), so every call passes the organization id resolved by
 * the tenant gate instead.
 */

type ListInvitations = NonNullable<Awaited<ReturnType<typeof authClient.organization.listInvitations>>["data"]>;

export type OrgInvitation = ListInvitations[number];

export const invitationsKey = (organizationId: string) => ["organization", organizationId, "invitations"];

export function useInvitations(organizationId: string) {
    return useQuery({
        queryKey: invitationsKey(organizationId),
        queryFn: async () => {
            const { data, error } = await authClient.organization.listInvitations({
                query: { organizationId },
            })

            if (error || !data) throw new Error(error?.code ?? "LIST_INVITATIONS_FAILED")

            // Cancelled and accepted invitations stay in the table; only what
            // somebody can still act on belongs on this screen
            return data.filter((invitation) => invitation.status === "pending")
        },
    })
}
