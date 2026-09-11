/**
 * Who a company is to a movement, and what that lets it do.
 *
 * Client-safe and pure. The same row is three different things to three
 * companies — its owner's books, the work an executor was offered, the load
 * a client is waiting on — and every read and every write starts by asking
 * which of the three the caller is.
 */

import type { MovementExecution, MovementStatus } from "@workspace/db/movements";

import { isAskable, isTerminal } from "@workspace/domain/movements/status";

/**
 * The caller's relation to one row. Precedence owner > executor > client: a
 * company can be the client of its own row (a carrier recording work for
 * itself is never both), and ownership is the relation that carries money.
 */
export type MovementRole = "owner" | "executor" | "client";

/** The fields a role is decided from. */
export type RoleInput = {
    organizationId: string;
    carrierOrgId: string | null;
    clientOrgId: string | null;
    status: MovementStatus;
    executionMovementId: string | null;
};

/**
 * An executor only has a relation to a row while it is actually involved:
 * the offer is in front of it, it answered no, or it is the company whose
 * truck the row is linked to. An owner who withdraws an offer and places the
 * load elsewhere has taken it back, and the first carrier stops seeing it.
 */
export const isExecutorOf = (row: RoleInput, tenantId: string): boolean =>
    row.carrierOrgId === tenantId
    && (row.status === "offered" || row.status === "declined" || row.executionMovementId !== null);

export function movementRole(row: RoleInput, tenantId: string): MovementRole | null {
    if (row.organizationId === tenantId) return "owner";
    if (isExecutorOf(row, tenantId)) return "executor";
    if (row.clientOrgId === tenantId) return "client";
    return null;
}

/**
 * The blocks of a row, by who may still change them and when. Once two
 * companies have agreed — the offer was accepted — the terms are what they
 * agreed: the route, the cargo and the price are copied into the executor's
 * row at that moment and freeze on both sides. What stays editable is each
 * side's own paperwork (invoice numbers, notes, costs) and, below the line,
 * the executor's own rig.
 */
export type EditableGroup =
    /** Route, cargo and dates */
    | "details"
    /** Who it is for and their reference */
    | "client"
    /** The amounts charged to the client */
    | "sellAmounts"
    /** The partner and the amounts paid to it */
    | "buy"
    /** Driver, truck, trailer, link */
    | "rig"
    /** Invoice numbers and dates, notes — each side's own paperwork */
    | "paperwork";

export type EditInput = {
    execution: MovementExecution;
    status: MovementStatus;
    /** An executor's row is linked below this one */
    linked: boolean;
    /** This row is an executor's copy of somebody else's order */
    hasParent: boolean;
    /** Partner execution only */
    executorOnPortal: boolean;
};

export function editableGroups(row: EditInput): EditableGroup[] {
    if (isTerminal(row.status)) return [];

    const groups: EditableGroup[] = ["paperwork"];
    const agreed = row.linked || row.hasParent;
    // A partner on the platform is holding the terms while it decides
    const offerInFlight = row.status === "offered";

    if (!agreed && !offerInFlight) groups.push("details");
    if (!row.hasParent) groups.push("client");
    if (!row.hasParent && !offerInFlight) groups.push("sellAmounts");

    // A partner that joined the portal after its load had already left is
    // still the off-platform partner it was on that load (status.ts)
    const asksPartner = row.execution === "partner" && row.executorOnPortal && isAskable(row.status);

    if (row.execution === "partner") {
        // On the platform the partner answers to these exact terms, so they
        // change only while nobody has been asked; off it, the owner is the
        // only one who can record that a price was renegotiated
        const open = asksPartner
            ? row.status === "procurement" || row.status === "declined"
            : !row.linked;

        if (open && !offerInFlight) groups.push("buy");
    }

    // The rig is whoever drives: the owner's own, or — for a partner off the
    // platform — the one the owner was told about. A partner on the platform
    // names its own driver in its own row.
    if (row.execution === "own-fleet" || (!row.linked && !asksPartner)) {
        groups.push("rig");
    }

    return groups;
}
