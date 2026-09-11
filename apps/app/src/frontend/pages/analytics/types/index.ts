/**
 * The analytics page's shared vocabulary: the period the URL carries, and the
 * five shapes the procedures return. No server-only import lives here — the
 * RSC pages prefetch with the same builders their client sections query with,
 * so both sides hash to one query key and nothing refetches on hydration.
 *
 * The period arithmetic is the staff reports' own, from
 * `@workspace/domain/kpis/types`: a figure that disagreed between Appload's
 * KPI page and the partner's own would be worse than no figure at all.
 */

import { kpiPeriod, maputoToday, type Get, type KpiFigures, type KpiPeriod } from "@workspace/domain/kpis/types";

import type { Currency } from "@/frontend/pages/orders/types";

export type { KpiFigures, KpiPeriod };

// ---------------------------------------------------------------------------
// The period. Two controls, and nothing else on the page changes what is
// counted — every query here is built from this one parser.
// ---------------------------------------------------------------------------

/**
 * The presets the page's two controls can express. The staff reports have a
 * fourth, `custom`, which needs a pair of dates this URL does not carry.
 */
export const ANALYTICS_PERIODS = ["month", "quarter", "year"] as const;

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/** What an empty URL means — the whole year, as the staff reports default. */
export const DEFAULT_PERIOD: AnalyticsPeriod = "year";

/** This year in Maputo: the year the page opens on, and the procedures' own default. */
export const currentYear = (): number => Number(maputoToday().slice(0, 4));

const isPeriod = (value: string | null): value is AnalyticsPeriod =>
    (ANALYTICS_PERIODS as readonly string[]).includes(value ?? "");

const boundedYear = (value: string | null): number | null => {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
};

/** `?period=` and `?year=` — the whole state of the page, and every query's input. */
export function analyticsInput(get: Get): { period: AnalyticsPeriod; year: number } {
    const period = get("period");

    return {
        period: isPeriod(period) ? period : DEFAULT_PERIOD,
        year: boundedYear(get("year")) ?? currentYear(),
    };
}

export type AnalyticsInput = ReturnType<typeof analyticsInput>;

/**
 * The range a preset and a year mean, resolved by the staff reports' own
 * parser. A month or a quarter with nothing else to go on is the current one
 * in Maputo, which is what those reports show for the same two controls.
 */
export const analyticsPeriod = (period: AnalyticsPeriod, year: number): KpiPeriod =>
    kpiPeriod((key) => (key === "period" ? period : key === "year" ? String(year) : null));

// ---------------------------------------------------------------------------
// The pipeline behind the dashboard tiles
// ---------------------------------------------------------------------------

/** The stages of the funnel, in the order a load passes through them. */
export const PIPELINE_STAGES = ["prospects", "booked", "onGoing", "delivered", "completed", "cancelled"] as const;

/** What is waiting on the reader right now — the counters the Orders pages already show. */
export const PIPELINE_ATTENTION = [
    "awaitingOffers",
    "offersToReview",
    "newRequests",
    "toDispatch",
    "onTheRoad",
    "deliveredPending",
] as const;

export type AnalyticsPipeline = {
    /** Every order the tenant may see. The stages are slices of it, not a partition of it */
    total: number;
    sections: Record<(typeof PIPELINE_STAGES)[number], number>;
    attention: Record<(typeof PIPELINE_ATTENTION)[number], number>;
};

// ---------------------------------------------------------------------------
// The year's chart, the money card, the KPI report and the partner ranking
// ---------------------------------------------------------------------------

export type AnalyticsMonth = {
    /** `YYYY-MM` of the loading month */
    month: string;
    orders: number;
    /** The ones that arrived: delivered, and the ones already settled after that */
    delivered: number;
    tons: number;
};

export type AnalyticsMonthly = {
    year: number;
    /** Twelve entries, zero-filled: a quiet month is a gap in the chart, not a missing bar */
    months: AnalyticsMonth[];
};

/**
 * One currency of the money card. Both figures are the tenant's own leg — what
 * a shipper owes and has paid, what a carrier is to receive and has received —
 * and currencies are never added together.
 */
export type AnalyticsMoneyLine = {
    currency: Currency;
    outstanding: number;
    settled: number;
    /** The shipper's own cargo insurance; null on a carrier's card, which never pays it */
    insurance: number | null;
};

export type AnalyticsMoney = {
    byCurrency: AnalyticsMoneyLine[];
    leg: "shipper" | "carrier";
};

/** One column of the KPI charts: a calendar month or an ISO week of the period. */
export type AnalyticsKpiBucket = {
    /** `yyyy-mm-dd` — the first day of the month, or the ISO Monday of the week */
    start: string;
    transports: number;
    tons: number;
    km: number;
    /** Arrivals on time at offloading, over the bucket's transports */
    onTimeRate: number | null;
    /** Travelling days, averaged over the trips that recorded one */
    averageDays: number | null;
    /** The tenant's own leg in USD; null when no transport of the bucket had a rate on file */
    usd: number | null;
};

export type AnalyticsKpis = {
    period: { preset: AnalyticsPeriod; from: string; to: string };
    figures: KpiFigures;
    buckets: AnalyticsKpiBucket[];
};

/** How the partner ranking is ordered. A ranking opens on its top, so it only ever descends. */
export const PARTNER_SORTS = ["orders", "tons", "usd", "onTime"] as const;

export type AnalyticsPartnerSort = (typeof PARTNER_SORTS)[number];

export type AnalyticsPartnerRow = {
    organizationId: string;
    name: string;
    orders: number;
    tons: number;
    onTimeRate: number | null;
    /** The tenant's own leg with this partner, in USD; null when nothing could be converted */
    usd: number | null;
    /** This partner's share of the period's orders, as a fraction */
    share: number;
};

export type AnalyticsPartners = {
    rows: AnalyticsPartnerRow[];
    sort: AnalyticsPartnerSort;
};

/**
 * One currency of the company's own loads — the orders it placed and the
 * trips it ran, never Appload's brokerage. Nothing is converted: a load sold
 * in rand and bought in meticais puts one figure in each line.
 */
export type AnalyticsLoadsLine = {
    currency: Currency;
    /** Its sell legs: what its clients still owe it, and what came in */
    receivable: { outstanding: number; settled: number };
    /** Its buy legs: what it still owes the partners it placed loads with, and what it paid */
    payable: { outstanding: number; settled: number };
    /** What the loads cost to run, and the part passed on to the client */
    costs: { total: number; rechargeable: number };
    /** Delivered and closed loads whose margin could be worked out in this currency, ex-VAT */
    margin: { gross: number; net: number; loads: number };
};

/** A company the tenant's own loads were for, or were handed to. */
export type AnalyticsLoadsPartner = {
    id: string | null;
    name: string;
    side: "client" | "partner";
    loads: number;
};

export type AnalyticsLoads = {
    year: number;
    /** Every load of the year, priced or not */
    total: number;
    byCurrency: AnalyticsLoadsLine[];
    /** Loads of the year that arrived — delivered or closed */
    finished: number;
    /** Of those, the ones with a margin: both legs in one currency, or an own-fleet trip with a price */
    comparable: number;
    /** Who the year's loads were with, most loads first */
    partners: AnalyticsLoadsPartner[];
};
