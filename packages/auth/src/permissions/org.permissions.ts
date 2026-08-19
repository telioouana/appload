import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc, adminAc, memberAc } from "better-auth/plugins/organization/access";

export const oac = createAccessControl({
    ...defaultStatements,
    order: ["create", "read", "update", "delete", "cancel", "list"],
    offer: ["create", "read", "update", "delete", "cancel", "list"],
    fleet: ["create", "read", "update", "delete", "list"],
})

export const owner = oac.newRole({
    ...ownerAc.statements,
    order: ["create", "read", "update", "delete", "cancel", "list"],
    offer: ["create", "read", "update", "delete", "cancel", "list"],
    fleet: ["create", "read", "update", "delete", "list"],
})

export const admin = oac.newRole({
    ...adminAc.statements,
    order: ["create", "read", "update", "cancel", "list"],
    offer: ["create", "read", "update", "cancel", "list"],
    fleet: ["create", "read", "update", "list"],
})

export const member = oac.newRole({
    ...memberAc.statements,
    order: ["read", "update", "list"],
    offer: ["read", "update", "list"],
    fleet: ["create", "read", "update", "list"],
})

export const driver = oac.newRole({
    ...memberAc.statements,
    order: ["read", "update"],
    fleet: ["read"],
})