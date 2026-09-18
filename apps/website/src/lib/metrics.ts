import "server-only"

import { count, notInArray, sql } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { order } from "@workspace/db/orders"

/**
 * Public aggregate metrics for the investor-facing home page. Fetched at
 * ISR time (the home page revalidates hourly), never per visitor.
 *
 * Deliberately no cumulative absolutes (GTV, total tons/km/loads, fleet
 * counts): those invite side-by-side comparison with much larger platforms.
 * Everything here is a growth rate, a ratio, or a coverage count — and the
 * quarterly chart ships indexed, so raw volumes never leave this module.
 *
 * Also deliberately no delivery-outcome metrics (on-time %, damage rates):
 * Appload is a marketplace connecting shippers and carriers, not the
 * transporter — the public site must not read as committing to delivery
 * times or cargo outcomes.
 */
export type PublicMetrics = {
    tonsGrowth: GrowthStat | null;
    loadsGrowth: GrowthStat | null;
    /** % of shippers with at least two billable orders; null below sample threshold */
    repeatShipperPct: number | null;
    /** Distinct served lanes: undirected pairs of normalized origin/destination provinces */
    corridors: number;
    /** Distinct Mozambican provinces touched by billable orders */
    provinces: number;
    /** Full years since the first billable order; null in year one */
    yearsActive: number | null;
    /** Oldest→newest full quarters, tons indexed to the first non-zero quarter = 100 */
    quarters: QuarterPoint[];
};

export type GrowthStat = {
    pct: number;
    /** yoy = trailing 4 full quarters vs the 4 before; qoq = last full quarter vs the one before */
    period: "yoy" | "qoq";
};

export type QuarterPoint = {
    /** e.g. "Q3 '25" */
    label: string;
    /** Tons relative to the first charted quarter (= 100) */
    index: number;
};

// Same billable rule the admin uses: prospects never became business and
// cancelled/underbid orders never moved cargo.
const billable = notInArray(order.status, ["prospect", "cancelled", "underbid"])

// Tons expression: prefer the actually-loaded weight, convert kg, and
// leave liquid (liter) orders out of the tonnage sum entirely.
const tonsExpression = sql<number>`coalesce(sum(
    case ${order.weightUnit}
        when 'ton' then coalesce(${order.loadedWeight}, ${order.weight})
        when 'kg' then coalesce(${order.loadedWeight}, ${order.weight}) / 1000
        else 0
    end
), 0)`

export async function getPublicMetrics(): Promise<PublicMetrics | null> {
    // Ride out transient connectivity blips (Neon over HTTP): a failed
    // attempt here would otherwise be cached by ISR as a placeholder page
    // for a full revalidation window.
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await fetchMetrics()
        } catch (error) {
            if (attempt === 3) {
                // The marketing page must render even when the database is
                // unreachable — the metrics section falls back to placeholders.
                console.error("Failed to load public metrics", error)
                return null
            }
            await new Promise((resolve) => setTimeout(resolve, attempt * 500))
        }
    }
    return null
}

async function fetchMetrics(): Promise<PublicMetrics> {
    const perShipper = db
        .select({ shipperId: order.shipperId, orders: count().as("orders") })
        .from(order)
        .where(billable)
        .groupBy(order.shipperId)
        .as("per_shipper")

    const [quarterRows, [shipperTotals], routeRows] = await Promise.all([
        db
            .select({
                year: sql<number>`extract(year from ${order.expectedLoadingDate})::int`.mapWith(Number),
                quarter: sql<number>`extract(quarter from ${order.expectedLoadingDate})::int`.mapWith(Number),
                loads: count(),
                tons: tonsExpression.mapWith(Number),
            })
            .from(order)
            .where(billable)
            .groupBy(
                sql`extract(year from ${order.expectedLoadingDate})`,
                sql`extract(quarter from ${order.expectedLoadingDate})`,
            ),
        db
            .select({
                shippers: count(),
                repeat: sql<number>`count(*) filter (where ${perShipper.orders} >= 2)`.mapWith(Number),
            })
            .from(perShipper),
        db
            .select({
                origin: sql<string | null>`${order.loadingAddress}->>'state'`,
                destination: sql<string | null>`${order.offloadingAddress}->>'state'`,
            })
            .from(order)
            .where(billable)
            .groupBy(
                sql`${order.loadingAddress}->>'state'`,
                sql`${order.offloadingAddress}->>'state'`,
            ),
    ])

    const fullQuarters = toFullQuarters(quarterRows)
    const coverage = toCoverage(routeRows)

    const shippers = shipperTotals?.shippers ?? 0

    return {
        // Base thresholds keep a near-zero denominator from producing an
        // absurd headline multiple.
        tonsGrowth: growthOf(fullQuarters, "tons", 50),
        loadsGrowth: growthOf(fullQuarters, "loads", 10),
        repeatShipperPct: shippers >= 10 && shipperTotals
            ? Math.round((100 * shipperTotals.repeat) / shippers)
            : null,
        corridors: coverage.corridors,
        provinces: coverage.provinces,
        yearsActive: toYearsActive(quarterRows),
        quarters: toIndexedSeries(fullQuarters),
    }
}

type FullQuarter = { label: string; tons: number; loads: number };

/**
 * Full years since the quarter of the first billable order (the quarterly
 * rows carry all history — they have no date filter). Null during year one,
 * where "0 years" would undersell rather than inform.
 */
function toYearsActive(rows: { year: number; loads: number; tons: number }[]): number | null {
    const active = rows.filter((row) => row.loads > 0 || row.tons > 0)
    if (active.length === 0) return null
    const firstYear = Math.min(...active.map((row) => row.year))
    const years = new Date().getUTCFullYear() - firstYear
    return years >= 1 ? years : null
}

/**
 * The last 8 FULL quarters, oldest→newest, gaps zero-filled. The current
 * (partial) quarter is excluded so the chart never ends on a fake dip.
 */
function toFullQuarters(
    rows: { year: number; quarter: number; loads: number; tons: number }[],
): FullQuarter[] {
    const byKey = new Map(rows.map((row) => [`${row.year}-${row.quarter}`, row]))

    const now = new Date()
    let year = now.getUTCFullYear()
    let quarter = Math.floor(now.getUTCMonth() / 3) + 1

    const series: FullQuarter[] = []
    for (let i = 0; i < 8; i++) {
        quarter -= 1
        if (quarter === 0) {
            quarter = 4
            year -= 1
        }
        const row = byKey.get(`${year}-${quarter}`)
        series.unshift({
            label: `Q${quarter} '${String(year).slice(2)}`,
            tons: Math.round(row?.tons ?? 0),
            loads: row?.loads ?? 0,
        })
    }
    return series
}

/**
 * Prefer year-over-year (trailing 4 full quarters vs the 4 before); fall
 * back to quarter-over-quarter while the platform is younger than 2 years.
 * Non-positive growth returns null — at this volume a single slow quarter
 * reads as noise, and the dashboard shows a placeholder instead.
 */
function growthOf(quarters: FullQuarter[], key: "tons" | "loads", minBase: number): GrowthStat | null {
    const sum = (slice: FullQuarter[]) => slice.reduce((total, q) => total + q[key], 0)

    const prior4 = sum(quarters.slice(0, 4))
    if (prior4 >= minBase) {
        return asGrowth(sum(quarters.slice(4)), prior4, "yoy")
    }

    const previous = quarters.at(-2)?.[key] ?? 0
    if (previous >= minBase) {
        return asGrowth(quarters.at(-1)?.[key] ?? 0, previous, "qoq")
    }
    return null
}

function asGrowth(current: number, base: number, period: GrowthStat["period"]): GrowthStat | null {
    const pct = Math.round((100 * (current - base)) / base)
    // Displayed as a multiple ("4.3×"): below +20% the rounded multiple
    // ("1.1×") both overstates and underwhelms, so show nothing instead.
    return pct >= 20 ? { pct, period } : null
}

/**
 * Chart series: full quarters from the first one with volume, tons indexed
 * to that quarter = 100. Only the index leaves the module — absolute tons
 * stay out of the page payload. Fewer than 4 quarters of history isn't a
 * silhouette worth charting, so the section stays hidden until then.
 */
function toIndexedSeries(quarters: FullQuarter[]): QuarterPoint[] {
    const firstWithVolume = quarters.findIndex((q) => q.tons > 0)
    if (firstWithVolume === -1) return []

    const charted = quarters.slice(firstWithVolume)
    if (charted.length < 4) return []

    const base = charted[0]!.tons
    return charted.map((q) => ({ label: q.label, index: Math.round((100 * q.tons) / base) }))
}

// Google Places writes the admin area in whatever locale the order was
// created with ("Sofala Province", "Sofala", "Província de Sofala") and
// sometimes a city instead of the province. Collapse everything to one
// lowercase ASCII key so coverage counts don't double-count variants.
const CITY_TO_PROVINCE: Record<string, string> = {
    "beira": "sofala",
    "dondo": "sofala",
    "chimoio": "manica",
    "matola": "maputo",
    "maputo city": "maputo",
    "xai-xai": "gaza",
    "xinavane": "maputo",
    "nacala": "nampula",
    "nacala porto": "nampula",
    "quelimane": "zambezia",
    "pemba": "cabo delgado",
    "lichinga": "niassa",
    "inhambane": "inhambane",
}

const MOZ_PROVINCES = new Set([
    "maputo", "gaza", "inhambane", "sofala", "manica",
    "tete", "zambezia", "nampula", "cabo delgado", "niassa",
])

function normalizeProvince(raw: string | null): string | null {
    if (!raw) return null
    const key = raw
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/^provincia\s+(?:de\s+|do\s+|da\s+)?/, "")
        .replace(/\s+province$/, "")
    if (!key) return null
    return CITY_TO_PROVINCE[key] ?? key
}

function toCoverage(rows: { origin: string | null; destination: string | null }[]) {
    const corridorKeys = new Set<string>()
    const provinceKeys = new Set<string>()

    for (const row of rows) {
        const origin = normalizeProvince(row.origin)
        const destination = normalizeProvince(row.destination)

        for (const province of [origin, destination]) {
            if (province && MOZ_PROVINCES.has(province)) provinceKeys.add(province)
        }
        // A corridor is a served lane regardless of direction.
        if (origin && destination) corridorKeys.add([origin, destination].sort().join("|"))
    }

    return { corridors: corridorKeys.size, provinces: provinceKeys.size }
}
