import type { Order } from "@workspace/db/orders";

import { primaryTransition, type OrderStatus } from "@/lib/orders/transitions";

/**
 * What the primary button does. A prospect opens the deal form aimed at
 * booking instead of flipping the status: an order saved as a prospect
 * almost always has gaps, so completing the form IS the next step — and the
 * form is the only place the fleet-derived loading bay gets refilled.
 */
export type OrderPrimaryAction =
    | { kind: "transition"; to: OrderStatus }
    | { kind: "confirm" };

/**
 * The single most relevant next step for an order — shared by the grid
 * card, the list row and the details page so every surface always agrees.
 * Role-agnostic on purpose: forward steps never need special roles, and
 * the server re-guards regardless. Interrupted orders return null here
 * (their resume target lives server-side) — the transition dialog covers
 * them.
 */
export function primaryOrderAction(order: Pick<Order, "status" | "route">): OrderPrimaryAction | null {
    if (order.status === "prospect") {
        return { kind: "confirm" };
    }

    const to = primaryTransition({
        status: order.status,
        route: order.route,
        role: "user",
        resumeStatus: null,
    });

    return to === null ? null : { kind: "transition", to };
}
