import { ORDER_STATUS, ROUTE_TYPE } from "@workspace/db/types";
import type { StaffRole } from "@workspace/auth/user-permissions";

export type OrderStatus = (typeof ORDER_STATUS)[number];
export type RouteType = (typeof ROUTE_TYPE)[number];

/**
 * The order state machine, shared verbatim by the server mutations and the
 * UI (dialogs, selects, card actions). The server re-guards every
 * transition — the client side of this module is presentation, not
 * authority.
 *
 * Statuses fall into three groups:
 * - the chain: prospect → booked → to-loading → at-loading → loading →
 *   waiting-documents → on-route → [at-border, regional only] →
 *   at-offloading → offloading → delivered → completed
 * - interrupts: stopped / issue park the chain; the resume target is
 *   derived from order_history on the server (never stored, so it can't
 *   drift)
 * - terminals: completed / cancelled / underbid, reversible only by an
 *   admin and always flagged for review. underbid is the prospect/booked
 *   order the shipper gave to a cheaper competitor — lost on price, not
 *   because the trip went away (that is cancelled)
 */

// What a transition demands before it may commit. "note" and the documents
// are payload requirements; "flag" marks the order for review as a side
// effect; "admin" restricts the move to the admin platform role.
export type TransitionRequirement = "note" | "evidence" | "pod" | "flag" | "admin";

export type TransitionContext = {
    status: OrderStatus;
    route: RouteType;
    role: StaffRole;
    // Required when status is stopped/issue: the last chain status before
    // the interrupt run, derived server-side from order_history
    resumeStatus?: OrderStatus | null;
};

export type TransitionVerdict =
    | { ok: true; requirements: TransitionRequirement[] }
    | { ok: false; code: "INVALID_STATE" | "NOT_ALLOWED" };

// Chain position. at-border sits between on-route and at-offloading;
// interrupts, cancelled and underbid carry no rank.
const RANK: Partial<Record<OrderStatus, number>> = {
    "prospect": 0,
    "booked": 1,
    "to-loading": 2,
    "at-loading": 3,
    "loading": 4,
    "waiting-documents": 5,
    "on-route": 6,
    "at-border": 6.5,
    "at-offloading": 7,
    "offloading": 8,
    "delivered": 9,
    "completed": 10,
};

// Explicit forward edges. The only permitted skip is loading → on-route
// (not every trip has a documents hold), and at-border → on-route is
// forward: the crossing is done and the truck is back on the road.
const FORWARD: Partial<Record<OrderStatus, OrderStatus[]>> = {
    "prospect": ["booked"],
    "booked": ["to-loading"],
    "to-loading": ["at-loading"],
    "at-loading": ["loading"],
    "loading": ["waiting-documents", "on-route"],
    "waiting-documents": ["on-route"],
    "on-route": ["at-border", "at-offloading"],
    "at-border": ["on-route", "at-offloading"],
    "at-offloading": ["offloading"],
    "offloading": ["delivered"],
    "delivered": ["completed"],
};

const INTERRUPTS: OrderStatus[] = ["stopped", "issue"];

// Only a quote can be lost on price: once the truck is rolling the order
// is cancelled, not underbid
const UNDERBID_FROM: OrderStatus[] = ["prospect", "booked"];

const isChain = (status: OrderStatus) => RANK[status] !== undefined;
const rank = (status: OrderStatus) => RANK[status] ?? NaN;

// Cargo is committed from loading onward: cancelling then needs evidence
// and raises the review flag; before that a note suffices
const cancelRequirements = (from: OrderStatus): TransitionRequirement[] | null => {
    if (INTERRUPTS.includes(from)) return ["note", "evidence", "flag"];
    if (!isChain(from) || rank(from) > rank("offloading")) return null;
    return rank(from) >= rank("loading") ? ["note", "evidence", "flag"] : ["note"];
};

/**
 * Classifies from → to and returns what the move demands, or null when the
 * move is not part of the machine at all. Route and resume constraints are
 * checked by validateTransition, not here.
 */
export function transitionRequirements(
    from: OrderStatus,
    to: OrderStatus,
    opts?: { resumeStatus?: OrderStatus | null },
): TransitionRequirement[] | null {
    if (from === to) return null;

    // Terminal reversals: admin only, always flagged, always explained
    if (from === "completed") {
        return to === "delivered" ? ["note", "flag", "admin"] : null;
    }
    if (from === "cancelled" || from === "underbid") {
        return to === "prospect" || to === "booked" ? ["note", "flag", "admin"] : null;
    }

    if (to === "cancelled") return cancelRequirements(from);
    // Losing on price is always explained (who won, at what price)
    if (to === "underbid") return UNDERBID_FROM.includes(from) ? ["note"] : null;

    // Interrupt handling: entering needs a note; switching between the two
    // interrupt states needs a note; resuming the derived chain status is
    // free (the interruption itself already carries the explanation)
    if (INTERRUPTS.includes(from)) {
        if (INTERRUPTS.includes(to)) return ["note"];
        if (opts?.resumeStatus && to === opts.resumeStatus) return [];
        // Not the resume target: allowed only as a flagged correction
        return isChain(to) && rank(to) >= rank("booked") && rank(to) <= rank("offloading")
            ? ["note", "flag"]
            : null;
    }
    if (INTERRUPTS.includes(to)) {
        // The truck can stop or hit an issue any time it is on the job;
        // a delivered order can still surface an issue before completion
        if (to === "issue" && from === "delivered") return ["note"];
        if (isChain(from) && rank(from) >= rank("to-loading") && rank(from) <= rank("offloading")) {
            return ["note"];
        }
        return null;
    }

    if (!isChain(from) || !isChain(to)) return null;

    if (FORWARD[from]?.includes(to)) {
        return to === "completed" ? ["pod"] : [];
    }

    // Backward on the chain: always a note plus the review flag. prospect is
    // only reachable back from booked; delivered only steps back one stage.
    if (rank(to) < rank(from)) {
        if (from === "delivered") return to === "offloading" ? ["note", "flag"] : null;
        if (to === "prospect") return from === "booked" ? ["note", "flag"] : null;
        if (rank(to) < rank("booked")) return null;
        return ["note", "flag"];
    }

    return null;
}

/**
 * Full validation for one move: machine membership, route constraint and
 * role constraint. The mutation additionally verifies the note/document
 * payloads that the returned requirements demand.
 */
export function validateTransition(ctx: TransitionContext, to: OrderStatus): TransitionVerdict {
    if (!ORDER_STATUS.includes(to)) return { ok: false, code: "INVALID_STATE" };

    // The border only exists on regional routes
    if (to === "at-border" && ctx.route !== "regional") {
        return { ok: false, code: "INVALID_STATE" };
    }

    const requirements = transitionRequirements(ctx.status, to, { resumeStatus: ctx.resumeStatus });

    if (requirements === null) return { ok: false, code: "INVALID_STATE" };
    if (requirements.includes("admin") && ctx.role !== "admin") {
        return { ok: false, code: "NOT_ALLOWED" };
    }

    return { ok: true, requirements };
}

/**
 * Every status the actor may move this order to — feeds the transition
 * select/dialogs so the UI only ever offers legal targets.
 */
export function allowedTransitions(ctx: TransitionContext): OrderStatus[] {
    return ORDER_STATUS.filter((to) => validateTransition(ctx, to).ok);
}

/** The single next forward step on the chain, if any — the primary action. */
export function primaryTransition(ctx: TransitionContext): OrderStatus | null {
    if (INTERRUPTS.includes(ctx.status)) return ctx.resumeStatus ?? null;

    const forward = FORWARD[ctx.status]?.filter(
        (to) => to !== "at-border" || ctx.route === "regional",
    );

    return forward?.[0] ?? null;
}
