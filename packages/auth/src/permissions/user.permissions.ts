import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, userAc, adminAc } from "better-auth/plugins/admin/access";

// Platform-scope access control for the staff-only admin app. Resource
// statements are the single source of truth consumed by the tRPC
// authorizedProcedure gate — UI gating alone can be bypassed via the API.
export const uac = createAccessControl({
    ...defaultStatements,
    organizations: ["create", "read", "update", "delete", "list", "block"],
    order: ["create", "read", "update", "transition", "cancel", "flag-resolve", "list"],
    document: ["create", "read", "delete", "list"],
    note: ["create", "void", "list"],
    // Proofs of payment move money on the order row (paid amount, payment
    // status, full-payment date); voiding one reverses money, so it is
    // supervisory. Checked inside the documents procedures on top of the
    // document:create / document:delete gates.
    payment: ["record", "void"],
    // Partner verification. `review` decides a document's fate, so it is
    // supervisory; `override` forces a re-review or lifts a suspension
    kyc: ["read", "list", "upload", "review", "override"],
    risk: ["read", "flag", "clear"],
    // Driver comms. `send` and `start` put messages on the company's WhatsApp
    // sender, so they are separated from reading the threads
    chat: ["read", "list", "send", "start"],
})

// Ops staff: full day-to-day order work, but resolving review flags,
// deleting documents and voiding notes are supervisory actions
export const user = uac.newRole({
    ...userAc.statements,
    organizations: ["create", "update", "read"],
    order: ["create", "read", "update", "transition", "cancel", "list"],
    document: ["create", "read", "list"],
    note: ["create", "list"],
    payment: ["record"],
    kyc: ["read", "list", "upload"],
    risk: ["read"],
    chat: ["read", "list", "send", "start"],
})
export const manager = uac.newRole({
    ...userAc.statements,
    user: [...userAc.statements.user, "ban", "list", "update", "get"],
    organizations: ["create", "read", "update", "list", "block"],
    order: ["create", "read", "update", "transition", "cancel", "flag-resolve", "list"],
    document: ["create", "read", "delete", "list"],
    note: ["create", "void", "list"],
    payment: ["record", "void"],
    kyc: ["read", "list", "upload", "review"],
    risk: ["read", "flag", "clear"],
    chat: ["read", "list", "send", "start"],
})
// Admin additionally owns the terminal reversals (completed → delivered,
// cancelled reinstate) — those are gated on the role itself, not a statement
export const admin = uac.newRole({
    ...adminAc.statements,
    organizations: ["create", "read", "update", "delete", "list", "block"],
    order: ["create", "read", "update", "transition", "cancel", "flag-resolve", "list"],
    document: ["create", "read", "delete", "list"],
    note: ["create", "void", "list"],
    payment: ["record", "void"],
    kyc: ["read", "list", "upload", "review", "override"],
    risk: ["read", "flag", "clear"],
    chat: ["read", "list", "send", "start"],
})

export const STAFF_ROLES = { user, manager, admin } as const;
export type StaffRole = keyof typeof STAFF_ROLES;

type Statements = typeof uac.statements;
export type Resource = keyof Statements;
export type Action<R extends Resource> = Statements[R][number];

/**
 * Pure permission check against the shared access-control roles. Client-safe:
 * the tRPC authorizedProcedure gate and UI button states both call this, so
 * the two surfaces can never disagree.
 */
export function isAuthorized<R extends Resource>(
    role: StaffRole,
    resource: R,
    actions: Action<R>[],
): boolean {
    const result = STAFF_ROLES[role].authorize({ [resource]: actions } as never);
    return result.success;
}
