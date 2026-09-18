import { and, asc, count, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import { billable, conditionCount } from "@workspace/domain/orders/predicates";
import {
    AGE_FACTOR,
    DEFAULT_COEFFICIENT,
    FUEL_LITRES_PER_KM,
    FUEL_PRICE_MZN_PER_LITRE,
    LOAD_FACTOR,
} from "@workspace/domain/kpis/constants";
import { ensureDailyRates } from "@workspace/domain/kpis/fx";
import type { KpiSort, PartyType } from "@workspace/domain/kpis/types";

/**
 * The KPI reports' SQL: the leg the money is read off, what counts as an
 * analysed transport, the per-trip fragments and the one aggregate every
 * report selects.
 *
 * Shared so the staff reports and the partner portal count the same
 * population with the same arithmetic — a figure that disagreed between the
 * two would be worse than no figure at all.
 */

type Db = typeof Database;

/** The list's sort directions, as the toolbar writes them. */
export type SortDir = "asc" | "desc";

/** The tenant a portal report is scoped to — its own leg of the trade. */
export type KpiTenant = { organizationId: string; orgType: "shipper" | "carrier" };

// Escape LIKE wildcards so a name typed with a % matches literally
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// ---------------------------------------------------------------------------
// The leg, and what counts as analysed
// ---------------------------------------------------------------------------

/**
 * The side of the order the report is about. `total` is the effective total —
 * base plus debit notes minus credit notes, the rule `lib/orders/totals.ts`
 * applies everywhere else — and the currency falls back to MZN like the
 * column default, so a leg saved before the currency was chosen still counts.
 */
export const leg = (type: PartyType) =>
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
export const within = (from: string, to: string): SQL =>
    and(
        billable(),
        gte(order.expectedLoadingDate, sql`${from}::timestamp`),
        lt(order.expectedLoadingDate, sql`(${to}::date + 1)::timestamp`),
    )!;

export const scope = (type: PartyType, from: string, to: string, party?: string): SQL =>
    and(
        within(from, to),
        // An order without a carrier has no carrier leg to report on
        type === "carrier" ? isNotNull(order.carrierId) : undefined,
        party ? eq(leg(type).id, party) : undefined,
    )!;

/**
 * A portal report never leaves its own tenant: the organization is pinned on
 * its own leg of the order, and the caller ANDs this into the `where` beside
 * `scope`. Staff reports never pass it.
 */
export const tenantScope = (tenant: KpiTenant): SQL =>
    eq(tenant.orgType === "shipper" ? order.shipperId : order.carrierId, tenant.organizationId);

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
export const FX = sql`(
        select r.day, r.usd_mzn, r.usd_zar
        from fx_daily_rate r
        where r.day <= ${order.expectedLoadingDate}::date
        order by r.day desc
        limit 1
    ) fx`;

/** Rates are local units per dollar ("USD→MZN", as the sheet's tab), so conversion divides. */
export const toUsd = (currency: SQL, amount: SQL) => sql`
    case ${currency}
        when 'USD' then ${amount}
        when 'ZAR' then ${amount} / fx.usd_zar
        else ${amount} / fx.usd_mzn
    end`;

export const rated = (currency: SQL) => sql`(${currency} = 'USD' or fx.day is not null)`;

/** Converted with a borrowed rate: the day itself is missing, an earlier one stood in. */
export const provisional = (currency: SQL) =>
    sql`(${currency} <> 'USD' and fx.day is not null and fx.day <> ${order.expectedLoadingDate}::date)`;

// ---------------------------------------------------------------------------
// Per-trip fragments
// ---------------------------------------------------------------------------

/**
 * A constant as a SQL numeric literal. Bound parameters arrive untyped, and
 * an untyped `$1` inside a `case` branch is what makes Postgres give up on
 * the expression's type — these are our own constants, never user input.
 */
export const num = (value: number) => sql.raw(String(value));

// The sheet reads every non-ton unit as kilogrammes; "liter" rows record their
// loaded weight in kg all the same, so they divide by a thousand too
export const TONS = sql`coalesce(case when ${order.weightUnit} = 'ton' then ${order.loadedWeight} else ${order.loadedWeight} / 1000 end, 0)`;

export const KM = sql`coalesce(${order.distance}, 0)`;

export const BACKLOAD = sql`${order.tripType} = 'backload'`;

export const REGIONAL = sql`${order.route} = 'regional'`;

/** Demurrage that was actually invoiced, at any of the three stops. */
export const DEMURRAGE_CHARGED = sql`(
    coalesce(${order.demurrageChargedAtLoading}, false)
    or coalesce(${order.demurrageChargedAtOffloading}, false)
    or coalesce(${order.demurrageChargedAtBorder}, false)
)`;

export const DEMURRAGE_DAYS = sql`(
    coalesce(${order.demurrageChargedDaysAtLoading}, 0)
    + coalesce(${order.demurrageChargedDaysAtOffloading}, 0)
    + coalesce(${order.demurrageChargedDaysAtBorder}, 0)
)`;

// The three CO₂ factors are editable per order; the sheet's own defaults stand
// in wherever the trip-details form left one empty
export const AGE = sql`coalesce(${order.ageFactor}, case when ${order.truckAge} = 'not-recent' then ${num(AGE_FACTOR["not-recent"])} else ${num(AGE_FACTOR.recent)} end)`;

export const LOAD = sql`coalesce(${order.loadFactor}, case when ${BACKLOAD} then ${num(LOAD_FACTOR.backload)} else ${num(LOAD_FACTOR.normal)} end)`;

export const COEFFICIENT = sql`coalesce(${order.defaultCoefficient}, case when ${BACKLOAD} then ${num(DEFAULT_COEFFICIENT.backload)} else ${num(DEFAULT_COEFFICIENT.normal)} end)`;

/** The sheet's formula verbatim — a plain total, never divided by the tonnage its label names. */
export const CO2 = sql`(${COEFFICIENT} * ${TONS} * ${KM} * ${AGE} * ${LOAD})`;

// Fuel is estimated in meticais (litres per km × MZN per litre) and only then
// converted, so the carrier's margin compares two USD figures — the sheet
// compared a MZN cost against a total in whatever currency the trip used
export const FUEL_USD = sql`(${KM} * ${num(FUEL_LITRES_PER_KM)} * ${num(FUEL_PRICE_MZN_PER_LITRE)} / fx.usd_mzn)`;

// ---------------------------------------------------------------------------
// The aggregate both procedures select
// ---------------------------------------------------------------------------

/** An empty group is a zero, not a null: these are totals, and the divisions come later. */
export const sumOf = (value: SQL) => sql<number>`coalesce(sum(${value}), 0)`.mapWith(Number);

export const sumWhere = (value: SQL, where: SQL) =>
    sql<number>`coalesce(sum(${value}) filter (where ${where}), 0)`.mapWith(Number);

/**
 * One SQL pass over the analysed transports. Selected as a spread by both
 * procedures — `parties` groups it by party, `report` runs it for one — so
 * the ranking and the report can never drift apart.
 *
 * `opts` is what the portal adds and staff never pass: omitted, this is
 * exactly the aggregate the admin reports have always selected.
 *
 * - `tenant` says whose money is being counted. The leg follows the tenant's
 *   own side of the trade whatever `type` the report is grouped by, so a
 *   carrier reading a per-client breakdown still totals its own invoices.
 *   The row filter belongs to the query, not to a column list — the caller
 *   ANDs `tenantScope(tenant)` into its `where`.
 * - TODO(portal): `groupBy: "partner"` — grouping by the opposite party id is
 *   the caller's own `.groupBy()` (it groups by `leg(other).id` while money
 *   stays on `leg(tenant.orgType)`), so nothing here has to change for it;
 *   the flag is accepted now and left unread until the portal's report
 *   procedure exists to pass it.
 */
export const aggregate = (
    type: PartyType,
    opts?: { tenant?: KpiTenant; groupBy?: "party" | "partner" },
) => {
    const { total, currency } = leg(opts?.tenant ? opts.tenant.orgType : type);
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
export const partyOrder = (type: PartyType, sort: KpiSort, dir: SortDir): SQL[] => {
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
export async function topUpRates(db: Db, where: SQL): Promise<void> {
    const day = sql<string>`to_char(${order.expectedLoadingDate}, 'YYYY-MM-DD')`;
    const days = await db.selectDistinct({ day }).from(order).where(where);

    await ensureDailyRates(db, days.map((row) => row.day));
}
