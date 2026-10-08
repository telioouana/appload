import { PLAN_PRICE, SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/types"

// ---------------------------------------------------------------------------
// Vocabulary shared by the URL parser, the server procedure and the toolbar.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 25

/**
 * Where a subscription stands. There is no "none": only organizations with a
 * plan are on the page, and a subscription ends by its expiry, never by
 * clearing the plan — so a row keeps its history as "expired".
 */
export const SUBSCRIPTION_STATES = ["active", "expiring", "expired"] as const
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number]

export const SUBSCRIPTION_SORTS = ["name", "plan", "expires"] as const
export type SubscriptionSort = (typeof SUBSCRIPTION_SORTS)[number]

export const ORGANIZATION_TYPES = ["shipper", "carrier"] as const

/** Days before expiry a subscription counts as "expiring". */
export const EXPIRING_WINDOW_DAYS = 30

/** How many months a company can pay for at once; plans are monthly, never open-ended. */
export const MONTH_OPTIONS = [1, 2, 3, 6, 12] as const

/**
 * When a subscription paid for `months` more months ends: counted from the
 * current expiry while that is still ahead (a renewal adds to what is left),
 * from `now` otherwise. The day of month is clamped, so the 31st plus one
 * month is the 30th, never the 1st of the month after.
 */
export function extendedExpiry(current: Date | null, months: number, now: Date = new Date()): Date {
    const start = current && current > now ? current : now
    const end = new Date(start)

    end.setDate(1)
    end.setMonth(end.getMonth() + months)
    end.setDate(Math.min(start.getDate(), new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()))

    return end
}

/**
 * When a plan changed today runs out: what is left of the current one is
 * worth `left × price(from)`, and that buys `÷ price(to)` of the new tier —
 * an upgrade ends sooner, a downgrade later, nothing is invoiced. The end
 * date stays when nothing is left to convert, or when either price is agreed
 * per customer.
 */
export function changedExpiry(current: Date | null, from: SubscriptionPlan, to: SubscriptionPlan, now: Date = new Date()): Date | null {
    const fromPrice = PLAN_PRICE[from]
    const toPrice = PLAN_PRICE[to]
    if (!current || current <= now || fromPrice === null || toPrice === null) return current

    return new Date(now.getTime() + ((current.getTime() - now.getTime()) * fromPrice) / toPrice)
}

export type SubscriptionRow = {
    id: string
    name: string
    logo: string | null
    type: "shipper" | "carrier"
    plan: SubscriptionPlan
    expiresAt: Date | null
    /** Set once staff cancel: the plan runs to expiresAt and is not renewed */
    cancelledAt: Date | null
    portalActivatedAt: Date | null
    /** Tracked movements billed this month */
    used: number
    /** The tier's monthly allowance; null = unlimited, 0 once expired */
    quota: number | null
    /** Movements past the allowance this month, each invoiced at the extra-trip price */
    extra: number
}

export type SubscriptionCounts = Record<"all" | SubscriptionState, number>

// ---------------------------------------------------------------------------
// URL parsing: the toolbar writes these params, the data view and the server
// prefetch read them through the same function.
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined

const parsePage = (value: string | null): number => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value)
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

export const subscriptionsListInput = (get: Get) => ({
    search: get("search")?.trim() || undefined,
    status: oneOf(get("status"), SUBSCRIPTION_STATES),
    type: oneOf(get("type"), ORGANIZATION_TYPES),
    plan: oneOf(get("plan"), SUBSCRIPTION_PLAN),
    sort: oneOf(get("sort"), SUBSCRIPTION_SORTS),
    dir: get("dir") === "desc" ? ("desc" as const) : ("asc" as const),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
})

export type SubscriptionsListInput = ReturnType<typeof subscriptionsListInput>

/** Whether anything narrows the list beyond its natural scope. */
export const isFilteredList = (get: Get) => ["search", "status", "type", "plan"].some((key) => Boolean(get(key)))
