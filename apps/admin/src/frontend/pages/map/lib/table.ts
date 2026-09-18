import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses"

import { matchesOrder } from "@/frontend/pages/map/lib/search"
import type { MapOrder } from "@/frontend/pages/map/types"

/**
 * The table view's arithmetic, kept out of the component: which rows the
 * filters keep, in what order, and what counts as a truck nobody has heard
 * from. The overview is one small array already on the client, so all of
 * it runs in the browser.
 */

/** A load whose last position is older than this — or has none — is shown in red. */
export const STALE_HOURS = 12

export type TableSortKey = "order" | "updated" | "hours"
export type TableSort = { key: TableSortKey; dir: "asc" | "desc" }

export const DEFAULT_TABLE_SORT: TableSort = { key: "updated", dir: "desc" }

export type TableFilters = {
    query: string
    stale: boolean
    status: string | null
    carrier: string | null
}

/** Whole hours since the last ping; null when there has never been one. */
export const hoursSince = (order: MapOrder, now: Date): number | null =>
    order.lastLocation ? Math.max(0, Math.floor((now.getTime() - order.lastLocation.recordedAt.getTime()) / 3_600_000)) : null

// Only a load the cron is actually pinging can be late answering: one still
// at the loading site is not tracked yet, so it is never drawn in red
export const isStale = (order: MapOrder, now: Date): boolean =>
    TRACKED_STATUSES.includes(order.status)
    && (!order.lastLocation || now.getTime() - order.lastLocation.recordedAt.getTime() > STALE_HOURS * 3_600_000)

/** The reverse-geocoded label, else what the driver attached, else the raw coordinates. */
export const placeText = (order: MapOrder): string | null => {
    const location = order.lastLocation
    if (!location) return null
    return location.placeLabel ?? location.placeName ?? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
}

export function filterRows(orders: MapOrder[], filters: TableFilters, now: Date): MapOrder[] {
    return orders.filter((order) =>
        matchesOrder(order, filters.query)
        && (!filters.stale || isStale(order, now))
        && (!filters.status || order.status === filters.status)
        && (!filters.carrier || order.carrierName === filters.carrier))
}

export function sortRows(orders: MapOrder[], sort: TableSort, now: Date): MapOrder[] {
    const sign = sort.dir === "asc" ? 1 : -1

    const compare = (a: MapOrder, b: MapOrder): number => {
        switch (sort.key) {
            case "order":
                return a.orderId.localeCompare(b.orderId)
            case "updated":
                // Never pinged sorts as the oldest, so it sinks on the default view
                return (a.lastLocation?.recordedAt.getTime() ?? 0) - (b.lastLocation?.recordedAt.getTime() ?? 0)
            case "hours":
                return (hoursSince(a, now) ?? Infinity) - (hoursSince(b, now) ?? Infinity)
        }
    }

    return [...orders].sort((a, b) => sign * compare(a, b) || a.orderId.localeCompare(b.orderId))
}
