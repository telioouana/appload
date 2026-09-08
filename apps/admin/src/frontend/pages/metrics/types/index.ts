import type { Currency } from "@/frontend/pages/orders/types"

/**
 * The metrics page's shared vocabulary. The sheet reader, the pure compute
 * step, the procedure and every card agree on these shapes, so a column that
 * changes meaning in the spreadsheet breaks the build in one place instead of
 * quietly printing a different number on three cards.
 *
 * Money is carried twice: `native`, exactly as Claire's STATS tab records it
 * per currency, and `usd`, converted with the month's own pinned rate. The
 * sheet's own "eq. USD" columns divide by *today's* rate, so last year's
 * revenue moves every morning — that is the whole reason this page exists.
 */

/** Where a pinned rate came from. Read `RateRow` for what each one means. */
export const RATE_SOURCES = ["feed", "yahoo", "manual"] as const

export type RateSource = (typeof RATE_SOURCES)[number]

/**
 * `MONTHLY RATES` is a tab Claire can edit, so the parser folds anything it
 * does not recognise to "manual": a source typed by hand means a rate pinned
 * by hand, and the card has copy for exactly these three.
 */
export const asRateSource = (value: unknown): RateSource => {
    const text = String(value ?? "").trim().toLowerCase()
    return (RATE_SOURCES as readonly string[]).includes(text) ? (text as RateSource) : "manual"
}

/** `2026-09` — the key every month, rate row and lookup map is filed under. */
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`

/** An amount split by the currency it was invoiced in — "MZN" | "ZAR" | "USD". */
export type NativeAmounts = Record<Currency, number>

/** National and regional trips, and their sum as the sheet counts it. */
export type TripCounts = {
    national: number
    regional: number
    total: number
}

/**
 * Money as the sheet holds it, before any conversion. Insurance and the VAT
 * on commission are MZN-only columns — Appload invoices both in Maputo.
 */
export type NativeTotals = {
    sales: NativeAmounts
    commission: NativeAmounts
    prospects: NativeAmounts
    /** Policies Appload subscribed, by currency */
    insurance: NativeAmounts
    /** VAT charged on the commission, by currency */
    iva: NativeAmounts
}

/** How the page presents money: dollars or meticais, both from the same monthly rates. */
export const PRESENTATION_CURRENCIES = ["usd", "mzn"] as const

export type PresentationCurrency = (typeof PRESENTATION_CURRENCIES)[number]

/** The `?currency=` URL param; absent (or anything else) means dollars, the page's default. */
export const metricsCurrency = (get: (key: string) => string | null): PresentationCurrency =>
    get("currency") === "mzn" ? "mzn" : "usd"

/** Everything a span earned in one presentation currency, converted at each month's opening rate. */
export type MoneyTotals = {
    sales: number
    commission: number
    net: number
    iva: number
    insurance: number
    prospects: number
    /** Money per trip — null whenever there were no trips */
    salesPerTrip: number | null
    commissionPerTrip: number | null
}

/**
 * The rate a month's money is converted with: the quote of its first day,
 * pinned once and never recomputed. `provisional` marks a month served with a
 * neighbour's rate because the feed could not be reached — the figure is
 * roughly right, and the page says so rather than showing a gap.
 */
export type MonthRate = {
    usdMzn: number
    usdZar: number
    source: RateSource
    /** ISO instant the row was written, or null for a rate typed into the sheet without one */
    pinnedOn: string | null
    provisional: boolean
}

/** One row of the `MONTHLY RATES` tab, as parsed. `month` is the `YYYY-MM` key. */
export type RateRow = {
    month: string
    usdMzn: number
    usdZar: number
    source: RateSource
    pinnedOn: string | null
    note: string | null
}

/**
 * One month of the logbook, folded from its orders (lib/metrics/logbook.ts):
 * counts and native money, nothing derived.
 */
export type SheetMonth = {
    year: number
    /** 1-12 */
    month: number
    trips: TripCounts
    deliveries: number
    distanceKm: number
    /** Names counted once within the month — they do not sum across months */
    shippers: number
    carriers: number
    native: NativeTotals
}

/** A month on the timeline: the sheet's row plus its rate and everything derived from the two. */
export type MetricMonth = {
    /** `2026-09` */
    key: string
    year: number
    /** 1-12 */
    month: number
    /** The current Maputo month, still filling up — shown, and labelled "to date" */
    partial: boolean
    trips: TripCounts
    deliveries: number
    distanceKm: number
    /** Names counted once within the month */
    shippers: number
    carriers: number
    native: NativeTotals
    rate: MonthRate
    /** The same money in each presentation currency; the header toggle picks one */
    money: Record<PresentationCurrency, MoneyTotals>
    /** commission ÷ sales — null when there were no sales */
    margin: number | null
}

/**
 * A year: its months summed, except for the partner counts. Shippers and
 * carriers are unique *within* a month, so adding twelve months would count
 * the same client twelve times — the year reports the mean over its active
 * months and the copy says "per month".
 */
/** Distinct shippers and carriers over some span of trips. */
export type PartyCount = { shippers: number; carriers: number }

/**
 * Shippers and carriers counted once per month, once per year and once over
 * the whole timeline, from the logbook's orders. The month figures do not
 * add up (the same client moves loads all year), which is why a year and the
 * lifetime are counted on their own rather than summed.
 */
export type PartyCounts = {
    months: Record<string, PartyCount>
    years: Record<number, PartyCount>
    lifetime: PartyCount
}

export type MetricYear = Omit<MetricMonth, "key" | "month" | "rate" | "shippers" | "carriers" | "native"> & {
    /** Months with any trips */
    activeMonths: number
    /** Names counted once across the year's orders */
    shippers: number
    carriers: number
    native: NativeTotals
    /** Share of USD-equivalent sales by the currency they were invoiced in; sums to 1 */
    currencyShare: Record<Currency, number>
    /** delta vs the previous year (same months when this year is partial), null for the first year */
    yoy: {
        trips: number | null
        sales: number | null
        commission: number | null
        net: number | null
    }
}

/** Every year added together, for the tables' footer row. */
export type MetricsLifetime = Omit<MetricYear, "year" | "yoy">

/**
 * What `metrics.overview` returns: the whole timeline in one payload, because
 * every card reads a different slice of the same months and a second query
 * would only re-read the same sheet.
 */
export type MetricsOverview = {
    months: MetricMonth[]
    years: MetricYear[]
    lifetime: MetricsLifetime
    /** `YYYY-MM` in Maputo time — the month marked "to date" */
    currentMonth: string
    /** ISO instant the sheet was last read successfully */
    fetchedAt: string
    /** The read failed and this is the last good snapshot; the header says so */
    stale: boolean
    /** Deep link to the logbook the numbers came from */
    sheetUrl: string
}

/** One key for the RSC prefetch and the sections: the query takes no input. */
export const overviewInput = () => undefined

/** The same `?year=` parser the dashboard uses, so both pages read one URL the same way. */
export { dashboardYear as metricsYear } from "@/frontend/pages/dashboard/types"
