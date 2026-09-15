import type { StaffRole } from "@workspace/auth/user-permissions";

/**
 * Who is asking. Every shared decision — the order state machine, the KYC
 * gate, the KPI scope — is taken on behalf of one of exactly two kinds of
 * caller, and the two are not interchangeable: staff act with a role across
 * every tenant, a partner acts only inside its own organization.
 *
 * Kept as a discriminated union rather than an optional field so a branch
 * that forgets one of the two cannot typecheck.
 */

/** An Appload staff session, carrying the role the permission gates read. */
export type StaffActor = {
    kind: "staff"
    userId: string
    role: StaffRole
};

/** A partner session, scoped to the organization it is a member of. */
export type TenantActor = {
    kind: "tenant"
    userId: string
    organizationId: string
    orgType: "shipper" | "carrier"
};

export type Actor = StaffActor | TenantActor;
