import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses"

import type { MapOrder } from "@/frontend/pages/map/types"
import { cashflowInput, currentYear } from "@/frontend/pages/orders/types"
// Type only, so the bundler erases it: the client never pulls the router in
import type { OrdersInput } from "@/frontend/pages/orders/server/procedures"

/**
 * The dashboard's shared vocabulary: the RSC page prefetches with these
 * builders and the client sections query with them, so both sides hash to
 * the same query key and nothing refetches on hydration.
 */

/** A truck heard from longer ago than this is silent — the queue and the tile hint agree on it. */
export const SILENT_AFTER_MS = 24 * 60 * 60 * 1000

/** Rows in the "Latest orders" table. */
export const LATEST_LIMIT = 8

/** Unread messages move faster than the rest of the queue, so they poll on their own. */
export const UNREAD_POLL_MS = 30_000

/** Orders that never ran: the chart's bottom band, and never money. */
export { LOST_STATUSES } from "@workspace/domain/orders/status-groups"

export type MonthPoint = {
    /** 1-12, the expected loading month */
    month: number
    completed: number
    delivered: number
    active: number
    prospect: number
    lost: number
    total: number
}

export type MonthlyOrders = {
    year: number
    /** Always twelve, January first, zero-filled — the axis never moves */
    months: MonthPoint[]
    totals: Omit<MonthPoint, "month">
}

type Get = (key: string) => string | null

/**
 * The `year` URL param, or undefined for "the current year" — the same rule
 * (and the same bounds) the orders lists parse with, so an absent param and
 * `{ year: undefined }` hash alike.
 */
export const dashboardYear = (get: Get): number | undefined => {
    const parsed = Number(get("year"))
    return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : undefined
}

export const yearInput = (year?: number) => ({ year })

export const moneyInput = (year?: number) =>
    ({ year, booked: "include" as const }) satisfies ReturnType<typeof cashflowInput>

/** The tiles are always "now": this year, whatever the year param says. */
export const tilesStatsInput = () => ({ year: currentYear() })

/** The most recently touched orders of the year, newest first. */
export const latestInput = () =>
    ({
        section: "all" as const,
        sort: "updated" as const,
        dir: "desc" as const,
        page: 1,
        pageSize: LATEST_LIMIT,
    }) satisfies OrdersInput

/** When a truck was last heard from; never-pinged sorts last on 0. */
export const seenAt = (order: MapOrder) => order.lastLocation?.recordedAt.getTime() ?? 0

/**
 * Silence is only a signal about a truck somebody is actually asking: the
 * cron pings from the moment the load leaves the loading site, so an order
 * still at loading has no pin by design and must not be reported as quiet.
 */
export const isSilent = (order: MapOrder, now: number) =>
    TRACKED_STATUSES.includes(order.status)
    && (!order.lastLocation || now - order.lastLocation.recordedAt.getTime() > SILENT_AFTER_MS)
