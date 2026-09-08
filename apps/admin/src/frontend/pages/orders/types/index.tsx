import type { Order } from "@workspace/db/orders"
import { CATEGORIES, CURRENCY, ORDER_STATUS, PAYMENT_STATUS, ROUTE_TYPE } from "@workspace/db/types"

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PagedResult, type SortDir } from "@/frontend/pages/partners/types"

export { DEFAULT_PAGE_SIZE, PAGE_SIZES }
export type { PagedResult, SortDir }

// The detail views and the shared item parts still type against the full row
export type OrderValues = Order

export type OrderStatus = (typeof ORDER_STATUS)[number]
export type Category = (typeof CATEGORIES)[number]
export type Currency = (typeof CURRENCY)[number]
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]
export type PaymentParty = "shipper" | "carrier"

/** The six pages under Orders in the sidebar; "all" is every status. */
export const SECTIONS = ["all", "prospect", "booked", "on-going", "delivered", "history"] as const
export type Section = (typeof SECTIONS)[number]
export type OrderSection = Exclude<Section, "all">

export const isSection = (value: string | undefined): value is Section =>
    value !== undefined && (SECTIONS as readonly string[]).includes(value)

/** Each section's route, typed against the routing table so a rename breaks the build. */
export const SECTION_PATHS = {
    "all": "/orders/all",
    "prospect": "/orders/prospect",
    "booked": "/orders/booked",
    "on-going": "/orders/on-going",
    "delivered": "/orders/delivered",
    "history": "/orders/history",
} as const satisfies Record<Section, `/orders/${string}`>

// The names the rest of the app imported before the sections became pages again
export const FILTERS = SECTIONS
export type FILTER = Section

// The coarse section each status belongs to — derived in code, never stored.
// The inverted map below is computed from this one so the two can never drift.
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

/** Which statuses a section covers — shared by the tab strip and the list procedure. */
export const statusFilter = (section: Section): OrderStatus[] =>
    section === "all" ? [...ORDER_STATUS] : SECTION_STATUSES[section]

// ---------------------------------------------------------------------------
// Sorting, paging and the filter vocabulary. One list of allowed values
// governs the URL parser, the server input and the toolbar.
// ---------------------------------------------------------------------------

export const ORDER_SORTS = ["seq", "loading", "total", "status", "updated"] as const
export type OrderSort = (typeof ORDER_SORTS)[number]

/** Newest first: the human id counts up within the year. */
export const DEFAULT_SORT: OrderSort = "seq"
export const DEFAULT_DIR: SortDir = "desc"

export const FIRST_YEAR = 2022
export const currentYear = () => new Date().getFullYear()

/** How far ahead the "loading due" filter looks. */
export const LOADING_WINDOW_DAYS = 7

/** A truck is still expected at the loading site in these states. */
export const PRE_LOADING_STATUSES: OrderStatus[] = ["booked", "to-loading", "at-loading"]

/** The trip is parked; the resume target lives server-side. */
export const INTERRUPTED_STATUSES: OrderStatus[] = ["stopped", "issue"]

/** Delivered but the proof of delivery has not come back yet. */
export const PENDING_POD_STATUSES = ["pending-collection", "pending-delivery"] as const

export const PAYMENT_PARTIES = ["shipper", "carrier"] as const

/** The payment filter: every stored status plus "outstanding" = pending or partially. */
export const PAYMENT_FILTERS = [...PAYMENT_STATUS, "outstanding"] as const
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number]
export const OUTSTANDING_STATUSES: PaymentStatus[] = ["pending", "partially"]

/** Quotes and lost orders were never owed, so no money view counts them. */
export const UNBILLABLE_STATUSES: OrderStatus[] = ["prospect", "cancelled", "underbid"]

export const BOOKED_MODES = ["include", "exclude"] as const
export type BookedMode = (typeof BOOKED_MODES)[number]

// ---------------------------------------------------------------------------
// Row and stats shapes the views consume
// ---------------------------------------------------------------------------

/** The columns the table and the CSV need — not the ~110 the row has. */
export type OrderRow = Pick<
    Order,
    | "id" | "orderId" | "year" | "seq" | "status"
    | "category" | "description" | "weight" | "weightUnit" | "isHazardous" | "isRefrigerated"
    | "loadingAddress" | "offloadingAddress" | "distance" | "route" | "tripType"
    | "expectedLoadingDate" | "expectedOffloadingDate" | "actualLoadingDate" | "actualOffloadingDate"
    | "shipperId" | "shipperName" | "shipperInvoiceNumber" | "shipperTotal" | "shipperCurrency"
    | "shipperPaymentStatus" | "shipperRemainingAmount" | "shipperRemainingPercentage"
    | "carrierId" | "carrierName" | "carrierInvoiceNumber" | "carrierTotal" | "carrierCurrency"
    | "carrierPaymentStatus" | "carrierRemainingAmount" | "carrierRemainingPercentage"
    | "driverName" | "driverPhoneNumber" | "truckPlate" | "trailerPlate"
    | "podStatus" | "flaggedForReview" | "disputeStatus" | "version" | "updatedAt"
> & {
    /**
     * Carrier offers still awaiting a decision. A prospect's carrier
     * column shows the count instead of a name — it has no carrier until
     * one of them is accepted — and the row's primary action reads it to
     * choose between "Add offer" and "Accept offer".
     */
    offerCount: number
}

export type OrderStats = {
    total: number
    bySection: Record<OrderSection, number>
    byStatus: Record<OrderStatus, number>
    /** Each key matches the URL filter its toggle opens */
    attention: {
        loading: number
        interrupted: number
        flagged: number
        pod: number
        disputed: number
    }
    /** What the pipeline needs a hand with today — the dashboard tiles' sub-lines */
    pipeline: {
        prospectsDueSoon: number
        loadingOverdue: number
    }
}

export type FilterOptions = {
    shippers: { id: string; name: string; count: number }[]
    carriers: { id: string; name: string; count: number }[]
    categories: { value: Category; count: number }[]
}

/**
 * One line per currency of the year's money still to move, read from
 * Appload's side: receivables come in from shippers, payables go out to
 * carriers, insurance Appload subscribed to is a cost against the
 * commission, and cashflow = receivables − payables − insurance. Never
 * summed across currencies.
 */
export type CashflowLine = {
    currency: Currency
    pendingShipper: number
    pendingCarrier: number
    receivables: number
    payables: number
    insurance: number
    cashflow: number
}

export type Cashflow = {
    year: number
    booked: BookedMode
    lines: CashflowLine[]
}

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the toolbar writes these params
// and the data view reads them, so the query key derives from the URL and
// the server prefetch can build the exact same input. Shared by both sides.
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Dates travel as yyyy-mm-dd strings: a Date object would serialise to a
// different instant on the server (UTC) and the client (Maputo) and split
// the query key in two
const isoDate = (value: string | null): string | undefined =>
    value && ISO_DATE.test(value) ? value : undefined

const integer = (value: string | null, min: number, max: number): number | undefined => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}

const parsePage = (value: string | null): number => integer(value, 1, 100_000) ?? 1

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value)
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

export const parseDir = (value: string | null): SortDir => (value === "asc" ? "asc" : value === "desc" ? "desc" : DEFAULT_DIR)

const flag = (value: string | null): true | undefined => (value === "1" || value === "true" ? true : undefined)

const text = (value: string | null): string | undefined => value?.trim() || undefined

/** The list input for a section page; the section comes from the route, everything else from the URL. */
export const ordersListInput = (section: Section, get: Get) => ({
    section,
    search: text(get("search")),
    status: oneOf(get("status"), ORDER_STATUS),
    category: oneOf(get("category"), CATEGORIES),
    paymentBy: oneOf(get("paymentBy"), PAYMENT_PARTIES),
    payment: oneOf(get("payment"), PAYMENT_FILTERS),
    year: integer(get("year"), 2000, 2100),
    month: integer(get("month"), 1, 12),
    from: isoDate(get("from")),
    to: isoDate(get("to")),
    shipper: text(get("shipper")),
    carrier: text(get("carrier")),
    loading: integer(get("loading"), 1, 365),
    interrupted: flag(get("interrupted")),
    flagged: flag(get("flagged")),
    pod: get("pod") === "pending" ? ("pending" as const) : undefined,
    insurance: get("insurance") === "pending" ? ("pending" as const) : undefined,
    disputed: flag(get("disputed")),
    hazardous: flag(get("hazardous")),
    refrigerated: flag(get("refrigerated")),
    route: oneOf(get("route"), ROUTE_TYPE),
    sort: oneOf(get("sort"), ORDER_SORTS),
    dir: parseDir(get("dir")),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
})

export type OrdersListInput = ReturnType<typeof ordersListInput>

/** The cashflow strip's input: the year and whether booked trips count. */
export const cashflowInput = (get: Get) => ({
    year: integer(get("year"), 2000, 2100),
    booked: get("booked") === "exclude" ? ("exclude" as const) : ("include" as const),
})

/**
 * Every URL key a filter control owns — everything that narrows the list
 * beyond its section and year. Used to tell "nothing yet" from "nothing
 * matched" in the empty state.
 */
export const FILTER_KEYS = [
    "search",
    "status",
    "category",
    "payment",
    "month",
    "from",
    "to",
    "shipper",
    "carrier",
    "loading",
    "interrupted",
    "flagged",
    "pod",
    "insurance",
    "disputed",
    "hazardous",
    "refrigerated",
    "route",
] as const

export const isFilteredOrders = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)))

/** The list input minus its paging, for an export that wants every matching row. */
export function withoutPaging<T extends { page: number; pageSize: number }>(input: T): Omit<T, "page" | "pageSize"> {
    const { page, pageSize, ...scope } = input
    void page
    void pageSize
    return scope
}

/**
 * Whole days a loading date is behind `today` (yyyy-mm-dd), or 0 when it is
 * today or later. Client-side only — the list shows it, nothing stores it.
 */
export function daysLate(expected: Date, today: string): number {
    const due = new Date(expected.getFullYear(), expected.getMonth(), expected.getDate())
    const now = new Date(`${today}T00:00:00`)
    return Math.max(0, Math.round((now.getTime() - due.getTime()) / 86_400_000))
}
