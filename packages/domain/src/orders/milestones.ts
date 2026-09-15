import type { Order, OrderHistoryKind } from "@workspace/db/orders";
import { LEGACY_ORDER_STATUS_ALIAS } from "@workspace/db/types";

import type { OrderStatus } from "@workspace/domain/orders/transitions";

/**
 * The history rows a milestone derivation needs. `order.get` already selects
 * exactly this shape, so callers pass their timeline straight through.
 */
export type MilestoneEntry = {
    kind: OrderHistoryKind;
    toStatus: string | null;
    createdAt: Date;
};

export type MilestoneState = "done" | "current" | "pending";

/** How the node is drawn: the ordinary chain, an interruption, or a closure. */
export type MilestoneTone = "chain" | "warning" | "danger";

export type MilestoneStep = {
    status: OrderStatus;
    state: MilestoneState;
    tone: MilestoneTone;
    at: Date | null;
    expected: Date | null;
    /** Punctuality of an arrival, for the stages that record one. */
    onTime: boolean | null;
};

// The chain in trip order. The two optional stages only show once they
// happened (or, for the border, when the route crosses one).
const CHAIN: OrderStatus[] = [
    "booked", "at-loading", "loading", "waiting-documents",
    "on-route", "at-border", "at-offloading", "offloading", "delivered", "completed",
];

const OPTIONAL: OrderStatus[] = ["waiting-documents", "at-border"];

// The dates the transitions stamp on the row — the fallback when the
// history predates a stage (orders imported from the sheets)
const STAMP: Partial<Record<OrderStatus, (order: Order) => Date | null>> = {
    "booked": (order) => order.dealDate,
    "at-loading": (order) => order.arrivalAtLoading,
    "loading": (order) => order.actualLoadingDate,
    "on-route": (order) => order.departureLoadingDate,
    "at-border": (order) => order.arrivalAtBorder,
    "at-offloading": (order) => order.arrivalAtOffloading,
    "offloading": (order) => order.actualOffloadingDate,
    "delivered": (order) => order.departureOffloadingDate,
};

const EXPECTED: Partial<Record<OrderStatus, (order: Order) => Date | null>> = {
    "at-loading": (order) => order.expectedLoadingDate,
    "at-offloading": (order) => order.expectedOffloadingDate,
};

/**
 * Where the trip is on its chain: one step per stage, with the date it was
 * reached. Dates come from the transition history first and the stamped row
 * columns second; the current stage is marked, and interrupts and terminals
 * hang off the last stage reached.
 *
 * Translation-free on purpose — the vertical rail in the order panel and the
 * horizontal strip on the details page render the same steps, so neither can
 * disagree with the other about where a trip is.
 */
export function deriveMilestones(order: Order, history: MilestoneEntry[]): MilestoneStep[] {
    const reached = new Map<string, Date>();
    for (const entry of history) {
        if (entry.kind !== "transition" || !entry.toStatus) continue;
        // The trail keeps the vocabulary it was written with: a dispatch
        // recorded as "to-loading" lights the step that replaced it, or the
        // chain would show a gap where the truck plainly went
        const status = LEGACY_ORDER_STATUS_ALIAS[entry.toStatus] ?? entry.toStatus;
        const previous = reached.get(status);
        if (!previous || entry.createdAt > previous) reached.set(status, entry.createdAt);
    }

    // The row itself may still be stored on the retired value until the
    // retirement script runs, and it reaches here raw (only the transition
    // door reads a status through `liveStatus`), so alias it the same way
    const current = LEGACY_ORDER_STATUS_ALIAS[order.status] ?? order.status;

    const currentIndex = CHAIN.indexOf(current);
    const offChain = currentIndex === -1;
    const interrupted = current === "stopped" || current === "issue";
    const terminal = current === "cancelled" || current === "underbid";

    const steps: MilestoneStep[] = CHAIN
        .filter((status) =>
            !OPTIONAL.includes(status)
            // An optional stage the order is parked on must never be dropped,
            // or the strip renders with no current node at all
            || status === current
            || reached.has(status)
            || (status === "at-border" && order.route === "regional"))
        .map((status) => {
            const at = reached.get(status) ?? STAMP[status]?.(order) ?? null;
            const index = CHAIN.indexOf(status);
            const done = at !== null || (!offChain && index < currentIndex);
            const state: MilestoneState = status === current ? "current" : done ? "done" : "pending";

            let onTime: boolean | null = null;
            if (status === "at-loading" && at) onTime = order.arrivalOnTimeLoading;
            if (status === "at-offloading" && at) onTime = order.arrivalOnTimeOffloading;

            return {
                status,
                state,
                tone: "chain" as const,
                at,
                expected: state === "pending" ? EXPECTED[status]?.(order) ?? null : null,
                onTime,
            };
        });

    // A prospect has not entered the chain yet; it is never also interrupted
    // or closed, so only one node is ever the current one
    if (current === "prospect") {
        steps.unshift({
            status: "prospect",
            state: "current",
            tone: "chain",
            at: order.createdAt,
            expected: null,
            onTime: null,
        });
    }

    if (interrupted || terminal) {
        // The parked or closed trip sits after the last stage it reached
        const last = steps.reduce((position, step, index) => (step.state === "done" ? index : position), -1);
        steps.splice(last + 1, 0, {
            status: current,
            state: "current",
            tone: interrupted ? "warning" : "danger",
            at: reached.get(current) ?? null,
            expected: null,
            onTime: null,
        });
    }

    return steps;
}
