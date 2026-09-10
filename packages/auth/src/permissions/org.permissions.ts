import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc, adminAc, memberAc } from "better-auth/plugins/organization/access";

export const oac = createAccessControl({
    ...defaultStatements,
    order: ["create", "read", "update", "delete", "cancel", "list"],
    offer: ["create", "read", "update", "delete", "cancel", "list"],
    fleet: ["create", "read", "update", "delete", "list"],
    partner: ["read", "request", "respond", "remove"],
    trip: ["create", "read", "update", "list"],
    document: ["read", "upload"],
    report: ["read"],
    subscription: ["read"],
})

export const owner = oac.newRole({
    ...ownerAc.statements,
    order: ["create", "read", "update", "delete", "cancel", "list"],
    offer: ["create", "read", "update", "delete", "cancel", "list"],
    fleet: ["create", "read", "update", "delete", "list"],
    partner: ["read", "request", "respond", "remove"],
    trip: ["create", "read", "update", "list"],
    document: ["read", "upload"],
    report: ["read"],
    subscription: ["read"],
})

export const admin = oac.newRole({
    ...adminAc.statements,
    order: ["create", "read", "update", "cancel", "list"],
    offer: ["create", "read", "update", "cancel", "list"],
    fleet: ["create", "read", "update", "list"],
    partner: ["read", "request", "respond"],
    trip: ["create", "read", "update", "list"],
    document: ["read", "upload"],
    report: ["read"],
    subscription: ["read"],
})

export const member = oac.newRole({
    ...memberAc.statements,
    order: ["read", "update", "list"],
    // Reads only on both: `offer:update` is what the booking door and the
    // offer decisions check, and registering a vehicle is the company's
    // own asset register — neither belongs to the lowest role
    offer: ["read", "list"],
    fleet: ["read", "list"],
    partner: ["read"],
    trip: ["create", "read", "update", "list"],
    document: ["read", "upload"],
    report: ["read"],
    subscription: ["read"],
})

export const driver = oac.newRole({
    ...memberAc.statements,
    order: ["read", "update"],
    fleet: ["read"],
})

export const ORG_ROLES = { owner, admin, member } as const;
export type OrgRole = keyof typeof ORG_ROLES;

type OrgStatements = typeof oac.statements;
export type OrgResource = keyof OrgStatements;
export type OrgAction<R extends OrgResource> = OrgStatements[R][number];

/**
 * Pure permission check against the shared organization roles. Client-safe:
 * the tRPC authorizedTenantProcedure gate and UI button states both call
 * this, so the two surfaces can never disagree.
 */
export function isOrgAuthorized<R extends OrgResource>(
    role: OrgRole,
    resource: R,
    actions: OrgAction<R>[],
): boolean {
    const result = ORG_ROLES[role].authorize({ [resource]: actions } as never);
    return result.success;
}