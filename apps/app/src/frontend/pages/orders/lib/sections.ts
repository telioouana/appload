import type { OrderDetail, OrderSection, OrderStatus, OrgType } from "@/frontend/pages/orders/types"

/** Closed for good: only Appload reopens these, and only from Admin. */
const TERMINAL: OrderStatus[] = ["completed", "cancelled", "underbid"]

/** The page an order of this status is on, for the party that owns it. */
const byStatus = (status: OrderStatus): OrderSection =>
    status === "prospect" ? "requests"
        : status === "booked" ? "booked"
            : status === "delivered" ? "delivered"
                : TERMINAL.includes(status) ? "history"
                    : "on-going"

/**
 * The list this order is on FOR THIS READER — what the detail page's back
 * button returns to. The status alone does not answer it: a carrier can open
 * an order it merely quoted for, and its pages are narrower than the client's
 * (a prospect it has answered has left "requests" for "quoted", and every
 * order that went to somebody else lives in "history").
 */
export const sectionForOrder = (order: OrderDetail, orgType: OrgType): OrderSection => {
    if (orgType === "shipper" || order.permissions.isMine) {
        return byStatus(order.status)
    }

    // The quote round is still open: the order sits under "quoted" once this
    // carrier has answered it, under "requests" while it still owes an answer
    if (order.status === "prospect") {
        if (order.offers.some((offer) => offer.isMine && offer.status === "pending")) return "quoted"

        return order.requests.some((request) => request.status === "requested") ? "requests" : "history"
    }

    // Booked, driven and closed by another carrier: all this one keeps is the
    // record of having bid
    return "history"
}
