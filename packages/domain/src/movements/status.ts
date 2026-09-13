/**
 * Where a movement may go next, what is missing on it, and the two things
 * that still stand in the way.
 *
 * Client-safe and pure: the door in apply.ts enforces these, and the portal
 * reads the same functions to decide which buttons to draw, so what the page
 * offers is exactly what the server accepts.
 *
 * Three shapes share one table and one vocabulary but not one lifecycle:
 *
 *   own fleet, or a partner off the platform — the owner runs the whole thing,
 *     procurement → scheduled → booked → in-transit → delivered → closed;
 *   a partner on the platform, not yet linked — the owner cannot schedule it,
 *     only ask: the offer, withdraw, accept and decline moves live in offer.ts
 *     because each of them involves a second company;
 *   linked — the truck belongs to the row below, so the load only moves when
 *     that row does (see propagation in apply.ts). The owner can still call it
 *     off before it leaves, and close it once it has arrived.
 *
 * Flags and blockers are not the same thing. A flag is what the load is
 * missing — no driver, no plate, no partner, no agreed price — and it never
 * stops anybody: the move goes through and the trail records that it went
 * through with the gap, so somebody can answer for it later. A blocker is one
 * of the two moves that genuinely cannot be taken: calling off a load that has
 * already been committed without saying why, and closing books that are not
 * settled.
 */

import type { MovementExecution, MovementStatus } from "@workspace/db/movements";

/** A movement that is over: nothing on it moves again. */
export const TERMINAL_STATUSES = ["closed", "cancelled"] as const satisfies readonly MovementStatus[];

/** A load somebody is already counting on, so calling it off needs a reason on record. */
const COMMITTED_STATUSES: readonly MovementStatus[] = ["scheduled", "booked", "in-transit"];

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
            case "booked": return ["cancelled"];
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
        case "scheduled": return ["booked", "in-transit", "cancelled"];
        case "booked": return ["in-transit", "cancelled"];
        case "in-transit": return ["delivered", "cancelled"];
        case "delivered": return ["closed"];
        case "declined": return ["procurement", "cancelled"];
        default: return [];
    }
}

/** What a load is missing. Never a refusal — see the header. */
export const MOVEMENT_FLAGS = ["NO_DRIVER", "NO_TRUCK", "NO_CARRIER", "NO_PRICE", "PHOTOS_UNAPPROVED"] as const;
export type MovementFlag = (typeof MOVEMENT_FLAGS)[number];

/** Why a move that is on the table cannot be taken at all. */
export type TransitionBlocker = "NOTE_REQUIRED" | "UNSETTLED";

/** The fields the guards and the flags read. */
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

/** Where a partner has to be named and priced, and where a rig has to exist. */
const NEEDS_CARRIER: readonly MovementStatus[] = ["scheduled", "booked", "in-transit"];
const NEEDS_RIG: readonly MovementStatus[] = ["booked", "in-transit"];

/**
 * What is missing on a row, read against the status it is at (or the one it is
 * about to be moved to, so the dialog can say what proceeding will record).
 *
 * A partner load is about who does it and for how much: from the moment the
 * load is placed, the point of having filed one is to know that. A rig is
 * asked for a booking onwards — a load with a date but no truck is a plan, one
 * booked without a plate is a gap — and only on the row that actually carries
 * it: a linked order's truck is named on the row below, not here.
 */
export function movementFlags(
    row: GuardInput & { linked: boolean; truckPlate: string | null; unapprovedPhotos: number },
    at: MovementStatus,
): MovementFlag[] {
    const flags: MovementFlag[] = [];
    const partner = row.execution === "partner";
    const rig = !row.linked && NEEDS_RIG.includes(at);

    if (rig && (!row.driverName || !row.driverPhone)) flags.push("NO_DRIVER");
    if (rig && !row.truckPlate) flags.push("NO_TRUCK");

    if (partner && NEEDS_CARRIER.includes(at)) {
        if (!row.carrierOrgId && !row.carrierName) flags.push("NO_CARRIER");
        if (!row.buyTotal || !row.buyCurrency) flags.push("NO_PRICE");
    }

    if (at === "in-transit" && row.unapprovedPhotos > 0) flags.push("PHOTOS_UNAPPROVED");

    return flags;
}

/**
 * What stands between a row and a target the table allows. Null means go.
 *
 * Only two things do. Somebody is counting on a committed load, so calling one
 * off is an answer somebody is owed, not a click; and closing is the books
 * being done — both sides paid, or nothing to pay. Everything else a load
 * lacks is a flag (see movementFlags), which the user may proceed past.
 */
export function transitionBlocker(row: GuardInput, to: MovementStatus, note?: string | null): TransitionBlocker | null {
    if (to === "cancelled" && COMMITTED_STATUSES.includes(row.status) && !note?.trim()) {
        return "NOTE_REQUIRED";
    }

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
        case "booked":
            return parent === "scheduled" ? { status: "booked", unlink: false } : null;
        case "in-transit":
            return parent === "scheduled" || parent === "booked" ? { status: "in-transit", unlink: false } : null;
        case "delivered":
            return parent === "scheduled" || parent === "booked" || parent === "in-transit"
                ? { status: "delivered", unlink: false }
                : null;
        case "cancelled":
            if (parent === "scheduled" || parent === "booked") return { status: "declined", unlink: true };
            if (parent === "in-transit") return { status: "cancelled", unlink: false };
            return null;
        default:
            return null;
    }
}
