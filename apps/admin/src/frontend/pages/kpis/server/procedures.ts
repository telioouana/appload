import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, countDistinct, desc, eq, gte, ilike, isNotNull, lt, sql, type SQL } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { deriveKpis } from "@/lib/kpis/compute";
import {
    AGE_FACTOR,
    DEFAULT_COEFFICIENT,
    FUEL_LITRES_PER_KM,
    FUEL_PRICE_MZN_PER_LITRE,
    LOAD_FACTOR,
} from "@/lib/kpis/constants";
import { ensureDailyRates } from "@/lib/kpis/fx";
import { billable, conditionCount } from "@/lib/orders/predicates";
import { KPI_SORTS, PARTY_TYPES, bucketGrain, bucketStarts } from "@/frontend/pages/kpis/types";
import type {
    KpiBucket,
    KpiPartyOption,
    KpiPartyRow,
    KpiReport,
    KpiSort,
    KpiStats,
    PartyType,
} from "@/frontend/pages/kpis/types";
import type { PagedResult, SortDir } from "@/frontend/pages/partners/types";

type Db = typeof Database;

/**
 * The KPIs page's four reads: the ranked list, its tiles, the picker's options
 * and one party's report.
 *
 * They all count the same population — the party's *analysed transports*, which
 * the KPI sheet defines as everything that was not cancelled and not a
 * prospect, loading inside the period — and they convert money the same way:
 * every leg is divided by the rate of its own loading day, so a report over a
 * company invoicing in meticais, rand and dollars adds up in USD without ever
 * mixing two years of exchange rate into one number.
 *
 * The heavy lifting is SQL on purpose. One pass returns counts and sums only;
 * `deriveKpis` does every division afterwards, in a pure function that can be
 * checked against the sheet by hand.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const period = { type: z.enum(PARTY_TYPES), from: isoDate, to: isoDate };

/** Both ends are inclusive, so a reversed range is a bug in the caller, not an empty report. */
const ordered = (value: { from: string; to: string }) => value.from <= value.to;

const RANGE = { message: "INVALID_RANGE", path: ["to"] };

/** The scope the tiles and the picker read: a side of the trade over a period. */
const ScopeInput = z.object(period).refine(ordered, RANGE);

/** That scope plus what the toolbar, the header search and the footer write. */
const ListInput = z
    .object({
        ...period,
        search: z.string().trim().max(120).optional(),
        sort: z.enum(KPI_SORTS).default("transports"),
        // A ranking opens on its top, so this list defaults the other way
        // round from the partner directories
        dir: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
    })
    .refine(ordered, RANGE);

const ReportInput = z.object({ ...period, party: z.string().min(1).max(64) }).refine(ordered, RANGE);

// Escape LIKE wildcards so a name typed with a % matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// ---------------------------------------------------------------------------
// The leg, and what counts as analysed
// ---------------------------------------------------------------------------

/**
 * The side of the order the report is about. `total` is the effective total —
 * base plus debit notes minus credit notes, the rule `lib/orders/totals.ts`
 * applies everywhere else — and the currency falls back to MZN like the
 * column default, so a leg saved before the currency was chosen still counts.
 */
const leg = (type: PartyType) =>
    type === "shipper"
        ? {
              id: order.shipperId,
              name: order.shipperName,
              total: sql`(coalesce(${order.shipperTotal}, 0) + ${order.shipperDebitTotal} - ${order.shipperCreditTotal})`,
              currency: sql`coalesce(${order.shipperCurrency}::text, 'MZN')`,
          }
        : {
              id: order.carrierId,
              name: order.carrierName,
              total: sql`(coalesce(${order.carrierTotal}, 0) + ${order.carrierDebitTotal} - ${order.carrierCreditTotal})`,
              currency: sql`coalesce(${order.carrierCurrency}::text, 'MZN')`,
          };

/**
 * Every analysed transport of the period, whichever side is being counted —
 * the tab counts need both at once.
 *
 * `expected_loading_date` is a `timestamp` stored at midnight, so the period
 * is compared against plain timestamps and never shifted into a timezone —
 * the local-midnight idiom the orders list uses would move January 1st by two
 * hours for everyone reading the page from Maputo.
 */
const within = (from: string, to: string): SQL =>
    and(
        billable(),
        gte(order.expectedLoadingDate, sql`${from}::timestamp`),
        lt(order.expectedLoadingDate, sql`(${to}::date + 1)::timestamp`),
    )!;

const scope = (type: PartyType, from: string, to: string, party?: string): SQL =>
    and(
        within(from, to),
        // An order without a carrier has no carrier leg to report on
        type === "carrier" ? isNotNull(order.carrierId) : undefined,
        party ? eq(leg(type).id, party) : undefined,
    )!;

// ---------------------------------------------------------------------------
// Money, in USD
// ---------------------------------------------------------------------------

/**
 * The rate of the trip's loading day, or the nearest earlier day on file.
 *
 * A lateral join rather than a plain one because the subquery has to see the
 * row's own loading date. Days the table lacks entirely leave `fx` null: the
 * trip's money then drops out of the totals and is counted as unrated, which
 * the page says out loud instead of quietly reporting a smaller total.
 */
const FX = sql`(
        select r.day, r.usd_mzn, r.usd_zar
        from fx_daily_rate r
        where r.day <= ${order.expectedLoadingDate}::date
        order by r.day desc
        limit 1
    ) fx`;

/** Rates are local units per dollar ("USD→MZN", as the sheet's tab), so conversion divides. */
const toUsd = (currency: SQL, amount: SQL) => sql`
    case ${currency}
        when 'USD' then ${amount}
        when 'ZAR' then ${amount} / fx.usd_zar
        else ${amount} / fx.usd_mzn
    end`;

const rated = (currency: SQL) => sql`(${currency} = 'USD' or fx.day is not null)`;

/** Converted with a borrowed rate: the day itself is missing, an earlier one stood in. */
const provisional = (currency: SQL) =>
    sql`(${currency} <> 'USD' and fx.day is not null and fx.day <> ${order.expectedLoadingDate}::date)`;

// ---------------------------------------------------------------------------
// Per-trip fragments
// ---------------------------------------------------------------------------

/**
 * A constant as a SQL numeric literal. Bound parameters arrive untyped, and
 * an untyped `$1` inside a `case` branch is what makes Postgres give up on
 * the expression's type — these are our own constants, never user input.
 */
const num = (value: number) => sql.raw(String(value));

// The sheet reads every non-ton unit as kilogrammes; "liter" rows record their
// loaded weight in kg all the same, so they divide by a thousand too
const TONS = sql`coalesce(case when ${order.weightUnit} = 'ton' then ${order.loadedWeight} else ${order.loadedWeight} / 1000 end, 0)`;

const KM = sql`coalesce(${order.distance}, 0)`;

const BACKLOAD = sql`${order.tripType} = 'backload'`;

const REGIONAL = sql`${order.route} = 'regional'`;

/** Demurrage that was actually invoiced, at any of the three stops. */
const DEMURRAGE_CHARGED = sql`(
    coalesce(${order.demurrageChargedAtLoading}, false)
    or coalesce(${order.demurrageChargedAtOffloading}, false)
    or coalesce(${order.demurrageChargedAtBorder}, false)
)`;

const DEMURRAGE_DAYS = sql`(
    coalesce(${order.demurrageChargedDaysAtLoading}, 0)
    + coalesce(${order.demurrageChargedDaysAtOffloading}, 0)
    + coalesce(${order.demurrageChargedDaysAtBorder}, 0)
)`;

// The three CO₂ factors are editable per order; the sheet's own defaults stand
// in wherever the trip-details form left one empty
const AGE = sql`coalesce(${order.ageFactor}, case when ${order.truckAge} = 'not-recent' then ${num(AGE_FACTOR["not-recent"])} else ${num(AGE_FACTOR.recent)} end)`;

const LOAD = sql`coalesce(${order.loadFactor}, case when ${BACKLOAD} then ${num(LOAD_FACTOR.backload)} else ${num(LOAD_FACTOR.normal)} end)`;

const COEFFICIENT = sql`coalesce(${order.defaultCoefficient}, case when ${BACKLOAD} then ${num(DEFAULT_COEFFICIENT.backload)} else ${num(DEFAULT_COEFFICIENT.normal)} end)`;

/** The sheet's formula verbatim — a plain total, never divided by the tonnage its label names. */
const CO2 = sql`(${COEFFICIENT} * ${TONS} * ${KM} * ${AGE} * ${LOAD})`;

// Fuel is estimated in meticais (litres per km × MZN per litre) and only then
// converted, so the carrier's margin compares two USD figures — the sheet
// compared a MZN cost against a total in whatever currency the trip used
const FUEL_USD = sql`(${KM} * ${num(FUEL_LITRES_PER_KM)} * ${num(FUEL_PRICE_MZN_PER_LITRE)} / fx.usd_mzn)`;

// ---------------------------------------------------------------------------
// The aggregate both procedures select
// ---------------------------------------------------------------------------

/** An empty group is a zero, not a null: these are totals, and the divisions come later. */
const sumOf = (value: SQL) => sql<number>`coalesce(sum(${value}), 0)`.mapWith(Number);

const sumWhere = (value: SQL, where: SQL) =>
    sql<number>`coalesce(sum(${value}) filter (where ${where}), 0)`.mapWith(Number);

/**
 * One SQL pass over the analysed transports. Selected as a spread by both
 * procedures — `parties` groups it by party, `report` runs it for one — so
 * the ranking and the report can never drift apart.
 */
const aggregate = (type: PartyType) => {
    const { total, currency } = leg(type);
    const money = toUsd(currency, total);

    return {
        transports: count(),
        total: sumOf(money),
        deliveries: sumOf(sql`${order.deliveries}`),
        tons: sumOf(TONS),
        km: sumOf(KM),
        tonKm: sumOf(sql`${TONS} * ${KM}`),

        onTimeLoading: conditionCount(eq(order.arrivalOnTimeLoading, true)),
        onTimeOffloading: conditionCount(eq(order.arrivalOnTimeOffloading, true)),

        // Durations are averaged over the trips that recorded one, so each sum
        // travels with the size of its own sample
        loadingDays: sumOf(sql`${order.daysSpendLoading}`),
        loadingDaysTrips: conditionCount(isNotNull(order.daysSpendLoading)),
        travelDays: sumOf(sql`${order.daysSpendTraveling}`),
        travelDaysTrips: conditionCount(isNotNull(order.daysSpendTraveling)),
        offloadingDays: sumOf(sql`${order.daysSpendOffloading}`),
        offloadingDaysTrips: conditionCount(isNotNull(order.daysSpendOffloading)),

        // Border time is a regional question only; a national trip crossing
        // nothing would otherwise pull the average to zero
        regionalTrips: conditionCount(REGIONAL),
        borderDays: sumWhere(sql`${order.daysSpendAtBorder}`, REGIONAL),
        borderDaysTrips: conditionCount(sql`${REGIONAL} and ${order.daysSpendAtBorder} is not null`),

        demurrageTrips: conditionCount(DEMURRAGE_CHARGED),
        demurrageDays: sumOf(DEMURRAGE_DAYS),

        accidents: sumOf(sql`${order.numberAccidents}`),
        mechanical: sumOf(sql`${order.numberOfMechanicalFailuresStops}`),
        documentation: sumOf(sql`${order.numberOfDocumentationIssuesStops}`),
        police: sumOf(sql`${order.numberOfPoliceStops}`),
        mechanicalDelayDays: sumOf(sql`${order.totalMechanicalFailuresDelayedDays}`),
        documentationDelayDays: sumOf(sql`${order.totalDocumentationIssuesDelayedDays}`),
        policeDelayDays: sumOf(sql`${order.totalPoliceDelayedDays}`),
        damaged: conditionCount(eq(order.cargoDamaged, true)),
        claimed: conditionCount(eq(order.claimed, true)),

        backloadTrips: conditionCount(BACKLOAD),
        co2: sumWhere(CO2, BACKLOAD),
        // The carrier's margin divides these two, so they have to count the
        // same trips: a day with no rate on file has no fuel figure, and a
        // USD leg would otherwise still add its money to the numerator
        backloadTotal: sumWhere(money, sql`${BACKLOAD} and fx.day is not null`),
        backloadFuel: sumWhere(FUEL_USD, BACKLOAD),

        // What the conversion note reports: the invoicing currencies in play,
        // and how many trips had to borrow a rate or go without one
        mzn: conditionCount(sql`${currency} = 'MZN'`),
        zar: conditionCount(sql`${currency} = 'ZAR'`),
        usd: conditionCount(sql`${currency} = 'USD'`),
        provisional: conditionCount(provisional(currency)),
        unrated: conditionCount(sql`not ${rated(currency)}`),
    };
};

/**
 * How the list is ranked, in the aggregate's own expressions: the page on
 * screen is one slice of an order the database has to work out in full, so a
 * sort can never be a `.sort()` over the rows that came back.
 *
 * Two rules keep the paging honest. A figure that does not exist sorts **last**
 * in either direction — a partner with no distance on file is not the cheapest
 * one per kilometre — and every ranking falls back to the name and then the id,
 * so consecutive OFFSET pages can neither repeat a partner nor skip one.
 */
const partyOrder = (type: PartyType, sort: KpiSort, dir: SortDir): SQL[] => {
    const { id, name, total, currency } = leg(type);
    const label = sql`max(${name})`;
    const money = sql`coalesce(sum(${toUsd(currency, total)}), 0)`;

    const by: Record<KpiSort, SQL> = {
        transports: sql`count(*)`,
        name: label,
        "on-time": sql`(${conditionCount(eq(order.arrivalOnTimeOffloading, true))})::float / count(*)`,
        price: sql`${money} / count(*)`,
        "cost-per-km": sql`${money} / nullif(sum(${KM}), 0)`,
        deliveries: sql`coalesce(sum(${order.deliveries}), 0)`,
        tons: sql`coalesce(sum(${TONS}), 0)`,
    };

    const first = sql`${by[sort]} ${sql.raw(dir)} nulls last`;

    return sort === "name" ? [first, asc(id)] : [first, sql`${label} asc`, asc(id)];
};

/**
 * Makes sure the loading days in scope have a rate before the report reads
 * them. Cheap — one distinct-day query — and it only ever fetches the days
 * the seed script has not caught up with yet; `ensureDailyRates` never throws,
 * so a dead feed costs a few provisional transports, not the page.
 */
async function topUpRates(db: Db, where: SQL): Promise<void> {
    const day = sql<string>`to_char(${order.expectedLoadingDate}, 'YYYY-MM-DD')`;
    const days = await db.selectDistinct({ day }).from(order).where(where);

    await ensureDailyRates(db, days.map((row) => row.day));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const kpisRouter = createTRPCRouter({
    /**
     * The list: every party of the chosen side that moved something in the
     * period, one page at a time and ranked by whichever column the toolbar
     * points at. Gated like the dashboard — the same figures already sit on
     * the orders pages.
     */
    parties: authorizedProcedure("order", ["list"])
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<KpiPartyRow>> => {
            const { type, from, to, search, sort, dir, page, pageSize } = input;
            const party = leg(type);

            const where = and(
                scope(type, from, to),
                // The order carries the name, so the search needs no join
                search ? ilike(party.name, `%${escapeLike(search)}%`) : undefined,
            )!;

            await topUpRates(ctx.db, where);

            // The name on the order is the name at the time; the latest one labels the row
            const name = sql<string>`max(${party.name})`;

            // The total counts partners, not orders, and does it without the
            // rate join: the page's own length would say nothing about how
            // many pages there are
            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select({ id: party.id, name, ...aggregate(type) })
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where)
                    .groupBy(party.id)
                    .orderBy(...partyOrder(type, sort, dir))
                    .limit(pageSize)
                    .offset((page - 1) * pageSize),

                ctx.db.select({ value: countDistinct(party.id) }).from(order).where(where),
            ]);

            const items = rows.flatMap((row): KpiPartyRow[] => {
                if (!row.id) return [];

                const kpis = deriveKpis(type, row);

                return [
                    {
                        id: row.id,
                        name: row.name,
                        transports: kpis.transports,
                        onTimeOffloadingRate: kpis.onTimeOffloadingRate,
                        pricePerTransport: kpis.pricePerTransport,
                        costPerKm: kpis.costPerKm,
                        deliveries: kpis.deliveries,
                        tons: kpis.tons,
                    },
                ];
            });

            return { items, total: counted?.value ?? 0, page, pageSize };
        }),

    /**
     * The tiles over the list, and the counts on its two tabs. The figures are
     * the whole period — the same aggregate the report runs, ungrouped — so
     * turning a page never moves them, and both sides are counted at once
     * because the tab that is not being listed still shows its number.
     */
    stats: authorizedProcedure("order", ["list"])
        .input(ScopeInput)
        .query(async ({ ctx, input }): Promise<KpiStats> => {
            const { type, from, to } = input;
            const where = scope(type, from, to);

            // The same top-up the list runs: the two are prefetched together,
            // and a loading day still without a rate would leave that money
            // out of the tiles until the list's own top-up had landed
            await topUpRates(ctx.db, where);

            const [totals, [parties]] = await Promise.all([
                ctx.db
                    .select(aggregate(type))
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where),

                // `count(distinct …)` drops nulls, which is exactly the
                // carrier-less order the carrier scope filters out
                ctx.db
                    .select({
                        shippers: countDistinct(order.shipperId),
                        carriers: countDistinct(order.carrierId),
                    })
                    .from(order)
                    .where(within(from, to)),
            ]);

            const shippers = parties?.shippers ?? 0;
            const carriers = parties?.carriers ?? 0;
            // An aggregate without a group by always returns exactly one row
            const kpis = deriveKpis(type, totals[0]!);

            return {
                partners: type === "shipper" ? shippers : carriers,
                transports: kpis.transports,
                total: kpis.total,
                deliveries: kpis.deliveries,
                km: kpis.km,
                onTimeLoadingRate: kpis.onTimeLoadingRate,
                onTimeOffloadingRate: kpis.onTimeOffloadingRate,
                shippers,
                carriers,
            };
        }),

    /**
     * The report's party picker: names and volumes only, busiest first, and no
     * rate join — nothing here is money, and the picker must open on a report
     * whose own query is still in flight.
     */
    partyOptions: authorizedProcedure("order", ["list"])
        .input(ScopeInput)
        .query(async ({ ctx, input }): Promise<KpiPartyOption[]> => {
            const { type, from, to } = input;
            const party = leg(type);
            const name = sql<string>`max(${party.name})`;

            const rows = await ctx.db
                .select({ id: party.id, name, transports: count() })
                .from(order)
                .where(scope(type, from, to))
                .groupBy(party.id)
                .orderBy(desc(count()), asc(name))
                .limit(250);

            return rows.flatMap((row) =>
                row.id ? [{ id: row.id, name: row.name, transports: row.transports }] : [],
            );
        }),

    /** One party's whole report: the figures, the chart buckets and the name to print on them. */
    report: authorizedProcedure("order", ["list"])
        .input(ReportInput)
        .query(async ({ ctx, input }): Promise<KpiReport> => {
            const { type, party, from, to } = input;
            const where = scope(type, from, to, party);
            const grain = bucketGrain(from, to);
            const columns = aggregate(type);

            await topUpRates(ctx.db, where);

            // `date_trunc('week', …)` starts on the ISO Monday, which is what
            // `bucketStarts` enumerates — the two have to agree or the
            // zero-fill drops a column and invents an empty one beside it
            const start =
                grain === "month"
                    ? sql<string>`to_char(date_trunc('month', ${order.expectedLoadingDate}), 'YYYY-MM-DD')`
                    : sql<string>`to_char(date_trunc('week', ${order.expectedLoadingDate}), 'YYYY-MM-DD')`;

            const [totals, buckets, [found]] = await Promise.all([
                ctx.db
                    .select(columns)
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where),

                ctx.db
                    .select({
                        start,
                        transports: columns.transports,
                        onTimeLoading: columns.onTimeLoading,
                        onTimeOffloading: columns.onTimeOffloading,
                        total: columns.total,
                        km: columns.km,
                    })
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where)
                    .groupBy(start),

                ctx.db
                    .select({ name: organization.name })
                    .from(organization)
                    .where(eq(organization.id, party)),
            ]);

            if (!found) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const counted = new Map(buckets.map((row) => [row.start, row]));

            return {
                type,
                party: { id: party, name: found.name },
                period: { from, to, grain },
                // An aggregate without a group by always returns exactly one row
                kpis: deriveKpis(type, totals[0]!),
                buckets: bucketStarts(from, to, grain).map((bucket): KpiBucket => {
                    const row = counted.get(bucket);

                    if (!row || row.transports === 0) {
                        return {
                            start: bucket,
                            transports: 0,
                            onTimeLoadingRate: null,
                            onTimeOffloadingRate: null,
                            pricePerTransport: null,
                            costPerKm: null,
                        };
                    }

                    return {
                        start: bucket,
                        transports: row.transports,
                        onTimeLoadingRate: row.onTimeLoading / row.transports,
                        onTimeOffloadingRate: row.onTimeOffloading / row.transports,
                        pricePerTransport: row.total / row.transports,
                        costPerKm: row.km > 0 ? row.total / row.km : null,
                    };
                }),
            };
        }),
});
