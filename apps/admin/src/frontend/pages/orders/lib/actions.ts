import type { Order } from "@workspace/db/orders";

import { primaryTransition, type OrderStatus } from "@/lib/orders/transitions";

/**
 * What the primary button does. A prospect is booked by accepting one of
 * its carrier offers — never by flipping the status — so its primary step
 * is the accept dialog, or adding the first offer when there is nothing to
 * accept yet.
 */
export type OrderPrimaryAction =
    | { kind: "transition"; to: OrderStatus }
    | { kind: "accept-offer" }
    | { kind: "add-offer" };

/**
 * The single most relevant next step for an order — shared by the table
 * row actions, the order sheet and the details page so every surface
 * always agrees.
 * Role-agnostic on purpose: forward steps never need special roles, and
 * the server re-guards regardless. An interrupted order's next step is
 * wherever it resumes, which only a caller holding the order's history can
 * know — pass `resumeStatus` (it rides on `order.get`) and the button names
 * that stage; omit it, as the table rows do, and interrupts return null so
 * the transition dialog covers them.
 * `pendingOffers` splits the two prospect actions; callers that don't count
 * offers leave it null and get accept-offer, whose dialog states the empty
 * case itself.
 */
export function primaryOrderAction(
    order: Pick<Order, "status" | "route">,
    resumeStatus: OrderStatus | null = null,
    pendingOffers: number | null = null,
): OrderPrimaryAction | null {
    if (order.status === "prospect") {
        return pendingOffers === 0 ? { kind: "add-offer" } : { kind: "accept-offer" };
    }

    const to = primaryTransition({
        status: order.status,
        route: order.route,
        role: "user",
        resumeStatus,
    });

    return to === null ? null : { kind: "transition", to };
}
