/**
 * Where a movement may go next, what is missing on it, and the few things
 * that still stand in the way.
 *
 * Client-safe and pure: the door in apply.ts enforces these, and the portal
 * reads the same functions to decide which buttons to draw, so what the page
 * offers is exactly what the server accepts.
 *
 * Three shapes share one table and one vocabulary but not one lifecycle:
 *
 *   own fleet, or a partner off the platform — the owner runs the whole thing,
 *     procurement → prospect → scheduled → booked, then the truck's own chain
 *     from at-loading to offloading → delivered → closed. A stop or an issue
 *     on the way is an interruption, and the load resumes at the stage it
 *     interrupted;
 *   a partner on the platform, not yet linked — the owner cannot schedule it,
 *     only ask: the offer, withdraw, accept and decline moves live in offer.ts
 *     because each of them involves a second company;
 *   linked — the truck belongs to the row below, so the load only moves when
 *     that row does (see propagation in apply.ts). The owner can still call it
 *     off before the truck reaches the loading site, and close it once it has
 *     arrived.
 *
 * Flags and blockers are not the same thing. A flag is what the load is
 * missing — no driver, no plate, no partner, no agreed price — and it never
 * stops anybody: the move goes through and the trail records that it went
 * through with the gap, so somebody can answer for it later. A blocker is one
 * of the few moves that genuinely cannot be taken: calling off a committed
 * load or reporting a truck held up without saying why, and closing books
 * that are still in dispute or not settled.
 */

import { MOVEMENT_IN_PROGRESS_STATUSES, type MovementExecution, type MovementStatus } from "@workspace/db/movements";

/** A movement that is over: nothing on it moves again. */
export const TERMINAL_STATUSES = ["closed", "cancelled"] as const satisfies readonly MovementStatus[];

/**
 * A truck on the load, from the loading site to offloading, interruptions
 * included: what the cron tracks and what a plan pays for. Stated in the
 * schema, which cannot import this module, and re-exported under its name here.
 */
export const IN_PROGRESS_STATUSES = MOVEMENT_IN_PROGRESS_STATUSES;

/** Where a truck is held up; each resumes at the stage it interrupted (`resumeStatus`). */
export const INTERRUPT_STATUSES = ["stopped", "issue"] as const satisfies readonly MovementStatus[];

/** Before anything is booked in: sourcing, quoting, asking, agreeing. */
export const PROCUREMENT_STATUSES = [
    "procurement",
    "prospect",
    "offered",
    "declined",
    "scheduled",
] as const satisfies readonly MovementStatus[];

/** A load somebody is already counting on, so calling it off needs a reason on record. */
const COMMITTED_STATUSES: readonly MovementStatus[] = ["scheduled", "booked", ...IN_PROGRESS_STATUSES];

export const isTerminal = (status: MovementStatus): boolean =>
    (TERMINAL_STATUSES as readonly MovementStatus[]).includes(status);

export const isInProgress = (status: MovementStatus | null | undefined): boolean =>
    (IN_PROGRESS_STATUSES as readonly (MovementStatus | null | undefined)[]).includes(status);

export const isInterrupt = (status: MovementStatus): boolean =>
    (INTERRUPT_STATUSES as readonly MovementStatus[]).includes(status);

/**
 * A move that puts a truck on the load: into the in-progress set from outside
 * it (from is null on create). The one test behind stamping `startedAt`,
 * charging the plan, recording usage and telling the client the load started,
 * so a resume after a stop, or a step along the chain, does none of them again.
 */
export const entersInProgress = (from: MovementStatus | null, to: MovementStatus): boolean =>
    !isInProgress(from) && isInProgress(to);

/** Where a partner load still waits on somebody agreeing to move it. */
export const isAskable = (status: MovementStatus): boolean =>
    status === "procurement" || status === "prospect" || status === "offered" || status === "declined";

/** What the transition table needs to know about a row. */
export type MovementShape = {
    execution: MovementExecution;
    status: MovementStatus;
    /** Only a regional load stops at a border */
    route: "national" | "regional";
    /** The stage an interruption resumes at; null outside one */
    resumeStatus: MovementStatus | null;
    /** An executor's own row is linked below this one */
    linked: boolean;
    /** Partner execution only: the executor can answer for itself on the portal */
    executorOnPortal: boolean;
};

/**
 * The moves the owner may make through the generic door, in the order the
 * page draws them: the first one that is neither back to procurement nor an
 * interruption nor a cancellation is the default button. Offer, withdraw and
 * the executor's answer are deliberately absent — they are not status
 * changes of one row but agreements between two companies.
 *
 * Nothing goes back along the chain: a truck that has loaded does not unload
 * by clicking. The exceptions are a prospect or a declined load returning to
 * procurement, which undoes an answer rather than a milestone.
 */
export function ownerTargets(shape: MovementShape): MovementStatus[] {
    const { execution, status, route, resumeStatus, linked, executorOnPortal } = shape;

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
    // with a partner that was off the platform when it started keeps the
    // lifecycle it started with when that partner later joins: there is no
    // offer to make any more, and without this the owner could neither
    // deliver it nor call it off, while the cron kept asking its driver
    if (execution === "partner" && executorOnPortal && isAskable(status)) {
        switch (status) {
            case "procurement": return ["cancelled"];
            case "offered": return ["cancelled"];
            // Quoted by hand before the partner joined: back to procurement,
            // and from there offered properly
            case "prospect": return ["procurement", "cancelled"];
            case "declined": return ["procurement", "cancelled"];
            default: return [];
        }
    }

    // Own fleet, or a partner with nobody on the portal to click accept
    switch (status) {
        case "procurement": return ["prospect", "scheduled", "at-loading", "cancelled"];
        case "prospect": return ["scheduled", "at-loading", "procurement", "cancelled"];
        case "declined": return ["procurement", "cancelled"];
        case "scheduled": return ["booked", "at-loading", "cancelled"];
        case "booked": return ["at-loading", "cancelled"];
        case "at-loading": return ["loading", "stopped", "issue", "cancelled"];
        case "loading": return ["waiting-documents", "on-route", "stopped", "issue", "cancelled"];
        case "waiting-documents": return ["on-route", "stopped", "issue", "cancelled"];
        case "on-route": return route === "regional"
            ? ["at-border", "at-offloading", "stopped", "issue", "cancelled"]
            : ["at-offloading", "stopped", "issue", "cancelled"];
        case "at-border": return ["on-route", "at-offloading", "stopped", "issue", "cancelled"];
        case "at-offloading": return ["offloading", "stopped", "issue", "cancelled"];
        case "offloading": return ["delivered", "stopped", "issue", "cancelled"];
        // An interruption resumes where the truck was. One that never
        // recorded where (data from before the column existed) can only be
        // restarted from the loading site or called off
        case "stopped": return resumeStatus ? [resumeStatus, "issue", "cancelled"] : ["at-loading", "cancelled"];
        case "issue": return resumeStatus ? [resumeStatus, "stopped", "cancelled"] : ["at-loading", "cancelled"];
        case "delivered": return ["closed"];
        default: return [];
    }
}

/** What a load is missing. Never a refusal — see the header. */
export const MOVEMENT_FLAGS = ["NO_DRIVER", "NO_TRUCK", "NO_CARRIER", "NO_PRICE", "PHOTOS_UNAPPROVED"] as const;
export type MovementFlag = (typeof MOVEMENT_FLAGS)[number];

/** Why a move that is on the table cannot be taken at all, in the order they are reported. */
export type TransitionBlocker = "NOTE_REQUIRED" | "DISPUTE_OPEN" | "UNSETTLED";

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
    /** The row is covered by an open dispute; read by the caller, since this module is pure */
    disputeOpen: boolean;
};

/** Where a partner has to be named and priced, and where a rig has to exist. */
const NEEDS_CARRIER: readonly MovementStatus[] = ["prospect", "scheduled", "booked", ...IN_PROGRESS_STATUSES];
const NEEDS_RIG: readonly MovementStatus[] = ["booked", ...IN_PROGRESS_STATUSES];

/**
 * What is missing on a row, read against the status it is at (or the one it is
 * about to be moved to, so the dialog can say what proceeding will record).
 *
 * A partner load is about who does it and for how much: from the moment the
 * load is quoted or placed, the point of having filed one is to know that. A
 * rig is asked for a booking onwards — a load with a date but no truck is a
 * plan, one booked without a plate is a gap — and only on the row that
 * actually carries it: a linked order's truck is named on the row below, not
 * here.
 *
 * Loading photos are approved before loading starts, so they are missing only
 * once the load is past the loading site. An interruption is judged by the
 * stage it interrupted: a truck stopped at the loading site has not loaded.
 * On a move into an interruption that stage is the status being left; on a
 * move between the two, or on the page, it is the one the row resumes at.
 */
export function movementFlags(
    row: GuardInput & {
        linked: boolean;
        truckPlate: string | null;
        unapprovedPhotos: number;
        resumeStatus: MovementStatus | null;
    },
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

    const stage = !isInterrupt(at) ? at : isInterrupt(row.status) ? row.resumeStatus : row.status;

    if (row.unapprovedPhotos > 0 && isInProgress(stage) && stage !== "at-loading") flags.push("PHOTOS_UNAPPROVED");

    return flags;
}

/**
 * What stands between a row and a target the table allows. Null means go.
 *
 * Only three things do. Somebody is counting on a committed load, so calling
 * one off is an answer somebody is owed, not a click — and so is saying a
 * truck is stopped or in trouble, or which of the two it now is. Closing is
 * the books being done, which they are not while a company on the load
 * disputes it, nor until both sides are paid or there is nothing to pay.
 * Everything else a load lacks is a flag (see movementFlags), which the user
 * may proceed past.
 */
export function transitionBlocker(row: GuardInput, to: MovementStatus, note?: string | null): TransitionBlocker | null {
    if (to === "cancelled" && COMMITTED_STATUSES.includes(row.status) && !note?.trim()) {
        return "NOTE_REQUIRED";
    }

    if (isInterrupt(to) && !note?.trim()) {
        return "NOTE_REQUIRED";
    }

    if (to === "closed" && row.disputeOpen) {
        return "DISPUTE_OPEN";
    }

    if (to === "closed" && (!row.sellSettled || !row.buySettled)) {
        return "UNSETTLED";
    }

    return null;
}

/**
 * What a parent row becomes when the row below it moves, or null when the
 * move is the executor's own business. Only the physical milestones travel —
 * the booking, every stage of the truck's chain, its arrival: how the
 * executor sources its own truck (procurement, a quote, a further offer)
 * stays below, and so does closing — every company settles its own books.
 * Where an interruption resumes travels with it (propagateUp copies it).
 *
 * An executor that backs out before the truck reaches the loading site hands
 * the load back rather than killing it: the parent returns to "declined",
 * unlinked, so its owner can place it again. Once the truck is on the load a
 * cancellation is an incident, and the parent is cancelled with it.
 */
export function upstreamStatus(
    parent: MovementStatus,
    child: MovementStatus,
): { status: MovementStatus; unlink: boolean } | null {
    if (child === "booked" || isInProgress(child) || child === "delivered") {
        const follows = parent === "scheduled" || parent === "booked" || isInProgress(parent);

        return follows && parent !== child ? { status: child, unlink: false } : null;
    }

    if (child === "cancelled") {
        if (parent === "scheduled" || parent === "booked") return { status: "declined", unlink: true };
        if (isInProgress(parent)) return { status: "cancelled", unlink: false };
    }

    return null;
}
