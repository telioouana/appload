/**
 * The KPI reports' shared vocabulary: the period arithmetic, the day helpers
 * and the shapes the SQL, the charts, the table and the PDF filler all read.
 * No server-only import lives here — an RSC page prefetches with the same
 * builders its client sections query with, so both sides hash to one query
 * key and nothing refetches on hydration.
 *
 * Two rules hold throughout. **Money is always USD**: a party invoices in
 * several currencies, so every amount is converted at its trip's own
 * loading-day rate before it reaches these shapes, and there is no currency
 * parameter to carry anywhere. And **dates are `yyyy-mm-dd` strings**, stepped
 * and compared through `Date.UTC` parts: a local `Date` would slide the first
 * day of a month by a whole timezone for anyone reading the page outside
 * Maputo, and `toISOString` on a local date is the same bug in reverse.
 */

export const PARTY_TYPES = ["shipper", "carrier"] as const

export type PartyType = (typeof PARTY_TYPES)[number]

export const PERIOD_PRESETS = ["month", "quarter", "year", "custom"] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** What an empty URL means. One constant, so the header and the parser cannot disagree. */
export const DEFAULT_PRESET: PeriodPreset = "year"

/** The list's sortable columns, in the toolbar's own order. Busiest first is the default. */
export const KPI_SORTS = ["transports", "name", "on-time", "price", "cost-per-km", "deliveries", "tons"] as const

export type KpiSort = (typeof KPI_SORTS)[number]

/** How the charts cut a period up: long ranges by calendar month, short ones by ISO week. */
export type BucketGrain = "month" | "week"

/**
 * A resolved period: the preset with the controls behind it, and the range
 * they mean. `year`, `month` and `quarter` are always filled — the selects
 * need something to show even while a custom range is on screen.
 */
export type KpiPeriod = {
    preset: PeriodPreset
    year: number
    /** 1-12 */
    month: number
    /** 1-4 */
    quarter: number
    /** `yyyy-mm-dd`, both ends inclusive */
    from: string
    to: string
}

// ---------------------------------------------------------------------------
// What the server counts, and what the page prints
// ---------------------------------------------------------------------------

/**
 * One SQL pass over the analysed transports — the party's billable orders
 * loading inside the period — before any division: counts and sums only, so
 * every figure `deriveKpis` prints can be checked against the sheet by hand.
 *
 * The `*Trips` fields are the sample sizes of the averages beside them: a
 * duration is averaged over the trips that recorded it, not over all of them.
 * Money is USD, converted per trip at its loading-day rate.
 */
export type KpiAggregate = {
    transports: number
    /** Effective leg total (base + debit − credit), in USD */
    total: number
    deliveries: number
    tons: number
    km: number
    /** Σ(tons × km), the divisor of the cost per ton-km */
    tonKm: number
    onTimeLoading: number
    onTimeOffloading: number
    loadingDays: number
    loadingDaysTrips: number
    travelDays: number
    travelDaysTrips: number
    offloadingDays: number
    offloadingDaysTrips: number
    regionalTrips: number
    /** Border days, counted over regional trips only as the sheet does */
    borderDays: number
    borderDaysTrips: number
    demurrageTrips: number
    demurrageDays: number
    accidents: number
    mechanical: number
    documentation: number
    police: number
    mechanicalDelayDays: number
    documentationDelayDays: number
    policeDelayDays: number
    damaged: number
    claimed: number
    backloadTrips: number
    /** The sheet's CO₂ formula summed over the backload trips */
    co2: number
    /** USD total and estimated fuel cost of those backload trips — the carrier's margin */
    backloadTotal: number
    backloadFuel: number
    /** Transports counted by the currency their leg was invoiced in */
    mzn: number
    zar: number
    usd: number
    /** Converted with the nearest earlier rate, and not converted at all */
    provisional: number
    unrated: number
}

/**
 * Everything the tiles, the table and the PDF print for one party and period.
 * A rate or an average is `null` whenever its divisor is empty — the page
 * prints "—" and the PDF "-", neither of them a misleading zero. Rates are
 * fractions (0.83), formatted as percentages at the edge; money is USD.
 */
export type KpiFigures = {
    transports: number
    total: number
    deliveries: number
    tons: number
    km: number
    pricePerTransport: number | null
    tonsPerTransport: number | null
    kmPerTransport: number | null
    onTimeLoadingRate: number | null
    onTimeOffloadingRate: number | null
    avgLoadingDays: number | null
    loadingDaysTrips: number
    avgTravelDays: number | null
    travelDaysTrips: number
    avgOffloadingDays: number | null
    offloadingDaysTrips: number
    avgBorderDays: number | null
    borderDaysTrips: number
    regionalTrips: number
    /** Distance per transport over its average travelling days (sheet E42) */
    kmPerDay: number | null
    demurrageRate: number | null
    demurrageDays: number
    accidents: number
    mechanical: number
    documentation: number
    police: number
    mechanicalDelayDays: number
    documentationDelayDays: number
    policeDelayDays: number
    /** The three delay columns added up, the sheet's "total delay days" row */
    delayDays: number
    damageRate: number | null
    claimRate: number | null
    costPerKm: number | null
    costPerTon: number | null
    costPerTonKm: number | null
    backloadTrips: number
    backloadShare: number | null
    co2: number
    /**
     * The last backload row, which asks a different question of each side:
     * what the shipper saved (USD), or the margin the carrier kept over the
     * fuel its backload trips burned (a fraction, null without a fuel figure).
     */
    backload: { kind: "savings"; value: number } | { kind: "fuelMargin"; value: number | null }
    /** Transports per invoicing currency, for the conversion note */
    byCurrency: { MZN: number; ZAR: number; USD: number }
    /** Converted with the nearest earlier rate, and not converted at all */
    provisionalTransports: number
    unratedTransports: number
}

/** One column of the charts: a calendar month or an ISO week of the period. */
export type KpiBucket = {
    /** `yyyy-mm-dd` — the first day of the month, or the ISO Monday of the week */
    start: string
    transports: number
    onTimeLoadingRate: number | null
    onTimeOffloadingRate: number | null
    pricePerTransport: number | null
    costPerKm: number | null
}

// ---------------------------------------------------------------------------
// Days, as strings
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const MAPUTO_DAY = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Maputo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
})

const iso = (year: number, month: number, day: number) =>
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

/** `[year, month, day]` of a `yyyy-mm-dd` string — month is 1-12, never a `Date`. */
const partsOf = (day: string): [number, number, number] => [
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)),
    Number(day.slice(8, 10)),
]

/** UTC midnight of a day string, the only clock this file steps time with. */
const epochOf = (day: string): number => {
    const [year, month, date] = partsOf(day)
    return Date.UTC(year, month - 1, date)
}

const dayOf = (time: number): string => {
    const date = new Date(time)
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/**
 * A `yyyy-mm-dd` day as the instant a formatter should print. Midnight UTC
 * is 02:00 in Maputo, the zone every date on the page is formatted in, so the
 * calendar day survives the trip — which a local `new Date(day)` would not
 * for anyone reading the admin from further east.
 */
export const utcDay = (day: string): Date => new Date(epochOf(day))

/** Day 0 of the next month is the last of this one. */
export const lastDay = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A real calendar day, not just four-two-two digits: 2026-02-30 is rejected. */
const asDay = (value: string | null): string | null => {
    if (!value || !ISO_DAY.test(value)) return null
    const [year, month, date] = partsOf(value)
    return month >= 1 && month <= 12 && date >= 1 && date <= lastDay(year, month) ? value : null
}

/**
 * Today in Maputo as `yyyy-mm-dd`. Isomorphic on purpose: the RSC page and the
 * browser resolve the same default period, so the prefetched query key matches.
 */
export const maputoToday = (): string => MAPUTO_DAY.format(new Date())

/**
 * The day a local `Date` falls on, by its local getters — for the range
 * picker, whose calendar hands back local midnights. `toISOString` would shift
 * those back a day for anyone east of Greenwich.
 */
export const toIsoDate = (date: Date): string => iso(date.getFullYear(), date.getMonth() + 1, date.getDate())

/** Months over weeks once a range touches three calendar months — twelve bars, not fifty-two. */
export const bucketGrain = (from: string, to: string): BucketGrain => {
    const [fromYear, fromMonth] = partsOf(from)
    const [toYear, toMonth] = partsOf(to)
    return toYear * 12 + toMonth - (fromYear * 12 + fromMonth) >= 2 ? "month" : "week"
}

/**
 * Every bucket the range touches, so the charts can zero-fill what the group
 * by never returned. Weeks start on the ISO Monday on or before `from`, which
 * is what Postgres `date_trunc('week', …)` returns — the first one therefore
 * reaches back before the period, and only its label is clamped.
 */
export const bucketStarts = (from: string, to: string, grain: BucketGrain): string[] => {
    const starts: string[] = []

    if (grain === "month") {
        const [fromYear, fromMonth] = partsOf(from)
        const [toYear, toMonth] = partsOf(to)
        for (let index = fromYear * 12 + fromMonth - 1; index <= toYear * 12 + toMonth - 1; index += 1) {
            starts.push(iso(Math.floor(index / 12), (index % 12) + 1, 1))
        }
        return starts
    }

    const first = epochOf(from)
    const monday = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS
    for (let start = monday; start <= epochOf(to); start += 7 * DAY_MS) {
        starts.push(dayOf(start))
    }
    return starts
}

// ---------------------------------------------------------------------------
// The URL
// ---------------------------------------------------------------------------

export type Get = (key: string) => string | null

const bounded = (value: string | null, min: number, max: number): number | null => {
    const parsed = Number(value)
    return value !== null && value !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max
        ? parsed
        : null
}

/** `?type=` — anything but "carrier" means shippers, the page's default side. */
export const kpiType = (get: Get): PartyType => (get("type") === "carrier" ? "carrier" : "shipper")

/**
 * `?period=` and its controls, resolved to a range. Absent or unknown values
 * fall back to the current Maputo year, month and quarter; a custom period
 * needs both dates and swaps them when they arrive reversed. A custom period
 * missing a date is not an empty page — it reports itself as the year preset,
 * so the header shows a live control and the URL can be corrected from there.
 */
export const kpiPeriod = (get: Get): KpiPeriod => {
    const [todayYear, todayMonth] = partsOf(maputoToday())
    const year = bounded(get("year"), 2000, 2100) ?? todayYear
    const month = bounded(get("month"), 1, 12) ?? todayMonth
    const quarter = bounded(get("quarter"), 1, 4) ?? Math.ceil(todayMonth / 3)
    const value = get("period")
    const preset = (PERIOD_PRESETS as readonly string[]).includes(value ?? "")
        ? (value as PeriodPreset)
        : DEFAULT_PRESET

    if (preset === "month") {
        return { preset, year, month, quarter, from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) }
    }

    if (preset === "quarter") {
        const last = quarter * 3
        return { preset, year, month, quarter, from: iso(year, last - 2, 1), to: iso(year, last, lastDay(year, last)) }
    }

    if (preset === "custom") {
        const from = asDay(get("from"))
        const to = asDay(get("to"))
        if (from && to) {
            return from <= to
                ? { preset, year, month, quarter, from, to }
                : { preset, year, month, quarter, from: to, to: from }
        }
    }

    return { preset: "year", year, month, quarter, from: iso(year, 1, 1), to: iso(year, 12, 31) }
}
