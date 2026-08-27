import "server-only"

import { and, count, isNotNull, ne, notInArray, sql } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { order } from "@workspace/db/orders"
import { truck } from "@workspace/db/fleet"
import { organization } from "@workspace/db/users"

/**
 * Public aggregate metrics for the investor-facing home page. Fetched at
 * ISR time (the home page revalidates hourly), never per visitor.
 */
export type PublicMetrics = {
    loadsDelivered: number;
    tonsMoved: number;
    kmCovered: number;
    carriers: number;
    shippers: number;
    trucks: number;
    /** Freight value handled, converted to USD with STATIC_USD_RATES */
    gtvUsd: number;
    /** Oldest→newest, at most 8 entries ending at the current quarter */
    quarters: QuarterPoint[];
};

export type QuarterPoint = {
    /** e.g. "Q3 '25" */
    label: string;
    tons: number;
    loads: number;
};

// Rough, deliberately conservative conversion rates for the public GTV
// headline (displayed as "≈ US$ …"). Adjust here when rates move a lot.
const STATIC_USD_RATES: Record<string, number> = {
    USD: 1,
    MZN: 1 / 64,
    ZAR: 1 / 18.5,
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

async function fetchMetrics(): Promise<PublicMetrics | null> {
    {
        const [orderTotals, gtvByCurrency, orgsByType, [trucks], quarterRows] = await Promise.all([
            db
                .select({
                    loadsDelivered: sql<number>`count(*) filter (where ${order.status} in ('delivered', 'completed'))`.mapWith(Number),
                    tons: tonsExpression.mapWith(Number),
                    km: sql<number>`coalesce(sum(${order.distance}), 0)`.mapWith(Number),
                })
                .from(order)
                .where(billable),
            db
                .select({
                    currency: order.shipperCurrency,
                    total: sql<number>`coalesce(sum(${order.shipperTotal}), 0)`.mapWith(Number),
                })
                .from(order)
                .where(and(billable, isNotNull(order.shipperTotal)))
                .groupBy(order.shipperCurrency),
            db
                .select({ type: organization.type, total: count() })
                .from(organization)
                .where(ne(organization.status, "closed"))
                .groupBy(organization.type),
            db.select({ total: count() }).from(truck),
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
        ])

        const totals = orderTotals[0]
        if (!totals) return null

        const gtvUsd = gtvByCurrency.reduce((sum, row) => {
            const rate = row.currency ? STATIC_USD_RATES[row.currency] ?? 0 : 0
            return sum + row.total * rate
        }, 0)

        return {
            loadsDelivered: totals.loadsDelivered,
            tonsMoved: Math.round(totals.tons),
            kmCovered: Math.round(totals.km),
            carriers: orgsByType.find((row) => row.type === "carrier")?.total ?? 0,
            shippers: orgsByType.find((row) => row.type === "shipper")?.total ?? 0,
            trucks: trucks?.total ?? 0,
            gtvUsd: Math.round(gtvUsd),
            quarters: toQuarterSeries(quarterRows),
        }
    }
}

function toQuarterSeries(
    rows: { year: number; quarter: number; loads: number; tons: number }[],
): QuarterPoint[] {
    const now = new Date()
    const currentYear = now.getUTCFullYear()
    const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1

    const byKey = new Map(rows.map((row) => [`${row.year}-${row.quarter}`, row]))

    // Walk back 8 quarters from the current one, filling gaps with zeros so
    // the chart never has holes.
    const series: QuarterPoint[] = []
    let year = currentYear
    let quarter = currentQuarter
    for (let i = 0; i < 8; i++) {
        const row = byKey.get(`${year}-${quarter}`)
        series.unshift({
            label: `Q${quarter} '${String(year).slice(2)}`,
            tons: Math.round(row?.tons ?? 0),
            loads: row?.loads ?? 0,
        })
        quarter -= 1
        if (quarter === 0) {
            quarter = 4
            year -= 1
        }
    }
    return series
}
