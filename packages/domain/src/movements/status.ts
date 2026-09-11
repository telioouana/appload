/**
 * Where a movement may go next, and what has to be true first.
 *
 * Client-safe and pure: the door in apply.ts enforces these, and the portal
 * reads the same functions to decide which buttons to draw, so what the page
 * offers is exactly what the server accepts.
 *
 * Three shapes share one table and one vocabulary but not one lifecycle:
 *
 *   own fleet, or a partner off the platform — the owner runs the whole thing,
 *     procurement → scheduled → in-transit → delivered → closed;
 *   a partner on the platform, not yet linked — the owner cannot schedule it,
 *     only ask: the offer, withdraw, accept and decline moves live in offer.ts
 *     because each of them involves a second company;
 *   linked — the truck belongs to the row below, so the load only moves when
 *     that row does (see propagation in apply.ts). The owner can still call it
 *     off before it leaves, and close it once it has arrived.
 */

import type { MovementExecution, MovementStatus } from "@workspace/db/movements";

/** A movement that is over: nothing on it moves again. */
export const TERMINAL_STATUSES = ["closed", "cancelled"] as const satisfies readonly MovementStatus[];

/** A load that has left, so calling it off needs a reason on record. */
const COMMITTED_STATUSES: readonly MovementStatus[] = ["scheduled", "in-transit"];

export const isTerminal = (status: MovementStatus): boolean =>
    (TERMINAL_STATUSES as readonly MovementStatus[]).includes(status);

/** Where a partner load still waits on somebody agreeing to move it. */
export const isAskable = (status: MovementStatus): boolean =>
    status === "procurement" || status === "offered" || status === "declined";

/** What the transition table needs to know about a row. */
export type MovementShape = {
    execution: MovementExecution;
    status: MovementStatus;
    /** An executor's own row is linked below this one */
    linked: boolean;
    /** Partner execution only: the executor can answer for itself on the portal */
    executorOnPortal: boolean;
};

/**
 * The moves the owner may make through the generic door. Offer, withdraw and
 * the executor's answer are deliberately absent — they are not status
 * changes of one row but agreements between two companies.
 */
export function ownerTargets(shape: MovementShape): MovementStatus[] {
    const { execution, status, linked, executorOnPortal } = shape;

    // The truck is somebody else's: the load moves when their row does
    if (linked) {
        switch (status) {
            case "scheduled": return ["cancelled"];
            case "delivered": return ["closed"];
            default: return [];
        }
    }

    // A partner who can answer on the portal is asked, never assumed — but
    // only while there is still something to ask. A load already on its way
    // with a partner that was off the platform when it left keeps the
    // lifecycle it started with when that partner later joins: there is no
    // offer to make any more, and without this the owner could neither
    // deliver it nor call it off, while the cron kept asking its driver
    if (execution === "partner" && executorOnPortal && isAskable(status)) {
        switch (status) {
            case "procurement": return ["cancelled"];
            case "offered": return ["cancelled"];
            case "declined": return ["procurement", "cancelled"];
            default: return [];
        }
    }

    // Own fleet, or a partner with nobody on the portal to click accept
    switch (status) {
        case "procurement": return ["scheduled", "in-transit", "cancelled"];
        case "scheduled": return ["in-transit", "cancelled"];
        case "in-transit": return ["delivered", "cancelled"];
        case "delivered": return ["closed"];
        case "declined": return ["procurement", "cancelled"];
        default: return [];
    }
}

/** Why a move that is on the table cannot be taken yet. */
export type TransitionBlocker =
    | "NO_DRIVER"
    | "NO_CARRIER"
    | "NO_PRICE"
    | "NOTE_REQUIRED"
    | "UNSETTLED";

/** The fields the guards read. */
export type GuardInput = {
    execution: MovementExecution;
    status: MovementStatus;
    driverName: string | null;
    driverPhone: string | null;
    carrierOrgId: string | null;
    carrierName: string | null;
    buyTotal: string | null;
    buyCurrency: string | null;
    sellSettled: boolean;
    buySettled: boolean;
};

/**
 * What stands between a row and a target the table allows. Null means go.
 *
 * Leaving procurement is where a load gets real: an own-fleet load needs the
 * driver the tracking will ask (a name for the message, a phone to send it
 * to), and a partner load needs the partner and the price — the whole point
 * of filing one is to know who did it and what was agreed.
 */
export function transitionBlocker(row: GuardInput, to: MovementStatus, note?: string | null): TransitionBlocker | null {
    const leavingProcurement = row.status === "procurement" && (to === "scheduled" || to === "in-transit");

    if (row.execution === "own-fleet" && (to === "scheduled" || to === "in-transit")) {
        if (!row.driverName || !row.driverPhone) return "NO_DRIVER";
    }

    if (row.execution === "partner" && leavingProcurement) {
        if (!row.carrierOrgId && !row.carrierName) return "NO_CARRIER";
        if (!row.buyTotal || !row.buyCurrency) return "NO_PRICE";
    }

    if (to === "cancelled" && COMMITTED_STATUSES.includes(row.status) && !note?.trim()) {
        return "NOTE_REQUIRED";
    }

    // Closing is the books being done: both sides paid, or nothing to pay
    if (to === "closed" && (!row.sellSettled || !row.buySettled)) {
        return "UNSETTLED";
    }

    return null;
}

/**
 * What a parent row becomes when the row below it moves, or null when the
 * move is the executor's own business. Only the physical milestones travel:
 * how the executor sources its own truck (procurement, a further offer) stays
 * below, and so does closing — every company settles its own books.
 *
 * An executor that backs out before the truck leaves hands the load back
 * rather than killing it: the parent returns to "declined", unlinked, so its
 * owner can place it again. Once the truck is on the road a cancellation is
 * an incident, and the parent is cancelled with it.
 */
export function upstreamStatus(
    parent: MovementStatus,
    child: MovementStatus,
): { status: MovementStatus; unlink: boolean } | null {
    switch (child) {
        case "in-transit":
            return parent === "scheduled" ? { status: "in-transit", unlink: false } : null;
        case "delivered":
            return parent === "scheduled" || parent === "in-transit" ? { status: "delivered", unlink: false } : null;
        case "cancelled":
            if (parent === "scheduled") return { status: "declined", unlink: true };
            if (parent === "in-transit") return { status: "cancelled", unlink: false };
            return null;
        default:
            return null;
    }
}
