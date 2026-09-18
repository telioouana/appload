/**
 * The KPIs page's shared vocabulary: the URL parsers, the period arithmetic
 * and the shapes the procedure, the charts, the table and the PDF filler all
 * read. No server-only import lives here — the RSC page prefetches with the
 * same builders the client sections query with, so both sides hash to one
 * query key and nothing refetches on hydration.
 *
 * The period arithmetic, the day helpers and the report shapes now live in
 * `@workspace/domain/kpis/types`, shared with the portal, and are re-exported
 * here so the page's own imports stay where they were. What is left is the
 * list's paging and the query keys, both of which are this page's own.
 */

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type SortDir } from "@/frontend/pages/partners/types"

import {
    KPI_SORTS,
    kpiPeriod,
    kpiType,
    type BucketGrain,
    type Get,
    type KpiBucket,
    type KpiFigures,
    type KpiSort,
    type PartyType,
} from "@workspace/domain/kpis/types"

export * from "@workspace/domain/kpis/types"

/** One row of the list: a party that moved something in the period. */
export type KpiPartyRow = {
    id: string
    name: string
    transports: number
    onTimeOffloadingRate: number | null
    pricePerTransport: number | null
    costPerKm: number | null
    deliveries: number
    tons: number
}

/**
 * The list's tiles, and the counts on its two tabs. The figures are the whole
 * period rather than the page on screen — a tile that changed when you turned
 * a page would be measuring the pagination, not the business — and `shippers`
 * and `carriers` are both sides at once, because the tabs have to carry their
 * counts while only one of them is being listed.
 */
export type KpiStats = {
    partners: number
    transports: number
    /** USD, converted per trip at its loading-day rate */
    total: number
    deliveries: number
    km: number
    onTimeLoadingRate: number | null
    onTimeOffloadingRate: number | null
    shippers: number
    carriers: number
}

/** One option of the report's party picker. */
export type KpiPartyOption = {
    id: string
    name: string
    transports: number
}

/** One party's report: what the page renders and what the PDF filler reads. */
export type KpiReport = {
    type: PartyType
    party: { id: string; name: string }
    period: { from: string; to: string; grain: BucketGrain }
    kpis: KpiFigures
    buckets: KpiBucket[]
}

/** `?sort=` — an unknown column ranks by transports, the ranking the page is for. */
const kpiSort = (get: Get): KpiSort => {
    const value = get("sort")
    return (KPI_SORTS as readonly string[]).includes(value ?? "") ? (value as KpiSort) : "transports"
}

/**
 * `?dir=` — descending unless asked otherwise, the opposite of the partner
 * directories: this list is a ranking, and a ranking opens on its top.
 */
const kpiDir = (get: Get): SortDir => (get("dir") === "asc" ? "asc" : "desc")

const parsePage = (value: string | null): number => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value)
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

/**
 * The four query keys of the two pages, and the *only* builders of them: the
 * RSC pages prefetch with these and the client sections query with these, so
 * both sides hash to one key and nothing refetches on hydration. Hand-writing
 * one of these objects at a call site is how a page ends up fetching the same
 * rows twice, one of the copies with a subtly different period.
 */

/** The tiles' scope: the whole period, whichever page the list is on. */
export const statsInput = (get: Get) => {
    const { from, to } = kpiPeriod(get)
    return { type: kpiType(get), from, to }
}

/** The picker's options are the same scope as the tiles — one shape, one alias. */
export const optionsInput = statsInput

/** The list's query: the period, plus everything the toolbar and the footer write. */
export const listInput = (get: Get) => ({
    ...statsInput(get),
    search: get("search")?.trim() || undefined,
    sort: kpiSort(get),
    dir: kpiDir(get),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
})

/** The report's query. The party comes from the route, not the query string. */
export const reportInput = (party: string, get: Get) => ({ ...statsInput(get), party })

/**
 * What a link from the list to a report carries over: the period and the side
 * of the trade, and nothing of the list's own paging. Back then lands on the
 * list exactly as it was left, because the browser kept that entry itself.
 */
export const carriedQuery = (get: Get): Record<string, string> => {
    const query: Record<string, string> = {}

    for (const key of ["type", "period", "year", "month", "quarter", "from", "to"]) {
        const value = get(key)
        if (value) query[key] = value
    }

    return query
}
