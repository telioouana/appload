"use client"

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@workspace/auth/client";

/**
 * Members and invitations come straight from Better Auth's organization
 * plugin — there is no tRPC router behind them (plan §4). Both endpoints
 * default to the session cookie's `activeOrganizationId`, which the portal
 * never trusts for tenancy (it is stale for up to five minutes after a
 * membership changes), so every call passes the organization id resolved by
 * the tenant gate instead.
 */

type ListMembers = NonNullable<Awaited<ReturnType<typeof authClient.organization.listMembers>>["data"]>;
type ListInvitations = NonNullable<Awaited<ReturnType<typeof authClient.organization.listInvitations>>["data"]>;

export type OrgMember = ListMembers["members"][number];
export type OrgInvitation = ListInvitations[number];

export const membersKey = (organizationId: string) => ["organization", organizationId, "members"];
export const invitationsKey = (organizationId: string) => ["organization", organizationId, "invitations"];

export function useMembers(organizationId: string) {
    return useQuery({
        queryKey: membersKey(organizationId),
        queryFn: async () => {
            const { data, error } = await authClient.organization.listMembers({
                query: { organizationId },
            })

            if (error || !data) throw new Error(error?.code ?? "LIST_MEMBERS_FAILED")

            return data
        },
    })
}

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
