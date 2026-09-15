import { ORDER_STATUS, PAYMENT_STATUS } from "@workspace/db/types"

/**
 * How the order statuses group. One list of sections, one map from status
 * to section, and the handful of status sets the counters, the filters and
 * the server predicates read — shared by both apps so a count is always the
 * count its filter opens, and by `orders/predicates` so the dashboard and
 * the order pages can never drift apart.
 */

export type OrderStatus = (typeof ORDER_STATUS)[number]
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

/** The six pages under Orders in the sidebar; "all" is every status. */
export const SECTIONS = ["all", "prospect", "booked", "on-going", "delivered", "history"] as const
export type Section = (typeof SECTIONS)[number]
export type OrderSection = Exclude<Section, "all">

// The coarse section each status belongs to — derived in code, never stored.
// The inverted map below is computed from this one so the two can never drift.
export const ORDER_STATUS_SECTION: Record<OrderStatus, OrderSection> = {
    "prospect": "prospect",
    "booked": "booked",
    "at-loading": "on-going",
    "loading": "on-going",
    "waiting-documents": "on-going",
    "on-route": "on-going",
    "stopped": "on-going",
    "issue": "on-going",
    "at-border": "on-going",
    "at-offloading": "on-going",
    "offloading": "on-going",
    "delivered": "delivered",
    "completed": "history",
    "cancelled": "history",
    "underbid": "history",
}

// A shipment currently occupying a truck, a driver and a carrier: booked
// through to offloading. Derived from the section map so the operational
// overlays on the partner pages can never drift from the order pages.
export const ACTIVE_STATUSES: OrderStatus[] = ORDER_STATUS.filter(
    (status) => status === "booked" || ORDER_STATUS_SECTION[status] === "on-going",
)

const SECTION_STATUSES = ORDER_STATUS.reduce(
    (sections, status) => {
        sections[ORDER_STATUS_SECTION[status]].push(status)
        return sections
    },
    { "prospect": [], "booked": [], "on-going": [], "delivered": [], "history": [] } as Record<OrderSection, OrderStatus[]>,
)

/** Which statuses a section covers — shared by the tab strip and the list procedure. */
export const statusFilter = (section: Section): OrderStatus[] =>
    section === "all" ? [...ORDER_STATUS] : SECTION_STATUSES[section]

export const currentYear = () => new Date().getFullYear()

/** How far ahead the "loading due" filter looks. */
export const LOADING_WINDOW_DAYS = 7

/** A truck is still expected at the loading site in these states. */
export const PRE_LOADING_STATUSES: OrderStatus[] = ["booked", "at-loading"]

/** The trip is parked; the resume target lives server-side. */
export const INTERRUPTED_STATUSES: OrderStatus[] = ["stopped", "issue"]

/** Delivered but the proof of delivery has not come back yet. */
export const PENDING_POD_STATUSES = ["pending-collection", "pending-delivery"] as const

export const OUTSTANDING_STATUSES: PaymentStatus[] = ["pending", "partially"]

/** Quotes and lost orders were never owed, so no money view counts them. */
export const UNBILLABLE_STATUSES: OrderStatus[] = ["prospect", "cancelled", "underbid"]

/** Orders that never ran: the chart's bottom band, and never money. */
export const LOST_STATUSES: OrderStatus[] = ["cancelled", "underbid"]
