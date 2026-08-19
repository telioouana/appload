import type { Order } from "@workspace/db/orders"
import { CATEGORIES, ORDER_STATUS, PAYMENT_STATUS } from "@workspace/db/types"

export type VIEW = "grid" | "list"

// The list procedure selects full rows, so the cards type against the row
export type OrderValues = Order

export const FILTERS = ["all", "prospect", "booked", "on-going", "delivered", "history"] as const
export type FILTER = (typeof FILTERS)[number]

export type OrderStatus = (typeof ORDER_STATUS)[number]
export type OrderSection = Exclude<FILTER, "all">

// The coarse section each status belongs to — derived in code, never stored.
// Sections match the page-filter slugs (and their pt route aliases), and the
// inverted map below is computed from this one so the two can never drift.
export const ORDER_STATUS_SECTION: Record<OrderStatus, OrderSection> = {
    "prospect": "prospect",
    "booked": "booked",
    "to-loading": "on-going",
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

const parseDate = (value: string | null) => {
    if (!value) return undefined
    const date = new Date(`${value}T00:00:00`)
    return isNaN(date.getTime()) ? undefined : date
}

const parseNumber = (value: string | null) => {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : undefined
}

// Builds the orders list input from the URL params. Shared by the client view
// and the server prefetch so both sides produce the exact same query key.
export const ordersListInput = (filter: FILTER, get: (key: string) => string | null) => ({
    filter,
    search: get("search") ?? undefined,
    category: (get("category") as (typeof CATEGORIES)[number] | null) ?? undefined,
    status: (get("status") as OrderStatus | null) ?? undefined,
    paymentBy: (get("paymentBy") as "shipper" | "carrier" | null) ?? undefined,
    payment: (get("payment") as (typeof PAYMENT_STATUS)[number] | null) ?? undefined,
    year: parseNumber(get("year")),
    month: parseNumber(get("month")),
    from: parseDate(get("from")),
    to: parseDate(get("to")),
})

// Single source of truth for which statuses each page filter covers,
// shared by the header view (pill strip) and the list procedure
export const statusFilter = (filter: FILTER): OrderStatus[] =>
    filter === "all" ? [...ORDER_STATUS] : SECTION_STATUSES[filter]
