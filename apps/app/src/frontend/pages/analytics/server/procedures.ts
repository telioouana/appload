import "server-only";

import { z } from "zod";
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { CURRENCY } from "@workspace/db/types";

import { deriveKpis } from "@workspace/domain/kpis/compute";
import { FX, TONS, aggregate, leg, scope, sumOf, tenantScope, toUsd, topUpRates, within, type KpiTenant } from "@workspace/domain/kpis/sql";
import { bucketGrain, bucketStarts } from "@workspace/domain/kpis/types";
import { billable, conditionCount } from "@workspace/domain/orders/predicates";
import { OUTSTANDING_STATUSES, PENDING_POD_STATUSES } from "@workspace/domain/orders/status-groups";
import { pendingOfferCount } from "@workspace/domain/orders/transition";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure } from "@workspace/trpc/tenant";

import { anyRequest, myRequest, orderScope, scopeOf, visibleOrders, type TenantScope } from "@/frontend/pages/orders/server/projection";
import type { Currency } from "@/frontend/pages/orders/types";
import {
    ANALYTICS_PERIODS,
    DEFAULT_PERIOD,
    PARTNER_SORTS,
    analyticsPeriod,
    currentYear,
    type AnalyticsKpiBucket,
    type AnalyticsKpis,
    type AnalyticsMonthly,
    type AnalyticsMoney,
    type AnalyticsMoneyLine,
    type AnalyticsPartnerRow,
    type AnalyticsPartnerSort,
    type AnalyticsPartners,
    type AnalyticsPipeline,
} from "@/frontend/pages/analytics/types";

/**
 * The partner's own reports: the pipeline behind the dashboard tiles, the
 * year's loads, the money still to move, the KPI report and the ranking of
 * the companies on the other side of the trade.
 *
 * Two rules hold in every query here. **The tenant predicate is the tenant's
 * own leg** (`tenantScope`) — a carrier that was asked about an order, or
 * quoted and lost it, has no order there — and **money is projected per leg**:
 * a shipper is counted on `shipper*`, a carrier on `carrier*`, and Appload's
 * commission is selected nowhere.
 *
 * The KPI arithmetic is the staff reports' own, from
 * `@workspace/domain/kpis`: the same population, the same fragments and the
 * same per-trip conversion at the loading day's rate, so a partner reading its
 * on-time rate here sees the number Appload sees.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const year = z.number().int().min(2000).max(2100).optional();

const YearInput = z.object({ year });

const PeriodInput = z.object({ period: z.enum(ANALYTICS_PERIODS).default(DEFAULT_PERIOD), year });

const PartnersInput = PeriodInput.extend({ sort: z.enum(PARTNER_SORTS).default("orders") });

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** The tenant as the shared KPI SQL scopes it: its own side of every order. */
const kpiTenant = (tenant: TenantScope): KpiTenant => ({
    organizationId: tenant.organizationId,
    orgType: tenant.orgType,
});

/** A counter that belongs to the other kind of organization counts nothing here. */
const zeroCount = sql<number>`0`.mapWith(Number);

/** Every section this counts has a predicate; only "all" has none. */
const stageCount = (section: "booked" | "on-going" | "delivered", tenant: TenantScope) =>
    conditionCount(orderScope(section, tenant.organizationId, tenant.orgType)!);

/** A load that arrived. Delivered orders keep moving to completed as they settle. */
const ARRIVED_STATUSES = ["delivered", "completed"] as const;

// Legs without a currency are Mozambican by default, like the column defaults
const currencyOf = (column: AnyColumn) => sql<string>`coalesce(${column}::text, 'MZN')`;

const isCurrency = (value: string): value is Currency => (CURRENCY as readonly string[]).includes(value);

/**
 * What a leg still owes, from canonical inputs: effective total (base + debit
 * notes − credit notes) minus what was paid, over the legs whose payment is
 * still open. The stored `*RemainingAmount` columns are NOT used — they stay
 * null until the first write after booking — and overpaid legs clamp to zero
 * so they never shrink the sum.
 */
const outstandingOf = (total: AnyColumn, debit: AnyColumn, credit: AnyColumn, paid: AnyColumn, status: AnyColumn) =>
    sql<number>`coalesce(sum(greatest(coalesce(${total}, 0) + ${debit} - ${credit} - coalesce(${paid}, 0), 0))
        filter (where ${inArray(status, OUTSTANDING_STATUSES)}), 0)`.mapWith(Number);

/**
 * A fresh currency line. The premium starts as "no such cost" rather than as
 * zero: a company that never subscribed cover has no insurance line at all,
 * and the sum below turns the null into a figure the moment there is one.
 */
const emptyLine = (currency: Currency): AnalyticsMoneyLine => ({
    currency,
    outstanding: 0,
    settled: 0,
    insurance: null,
});

/** A currency earns its row by having money on it; a quiet year leaves the card empty. */
const carries = (line: AnalyticsMoneyLine) => Boolean(line.outstanding || line.settled || line.insurance);

/**
 * How the ranking is ordered, in the aggregate's own expressions: the rows on
 * screen are one slice of an order the database has to work out in full. It
 * only ever descends — a ranking opens on its top — and ties fall back to the
 * name and then the id, so two partners that moved the same load count can
 * neither swap places between reads nor hide each other.
 */
const partnerOrder = (sort: AnalyticsPartnerSort, money: SQL, name: SQL, id: AnyColumn): SQL[] => {
    const by: Record<AnalyticsPartnerSort, SQL> = {
        orders: sql`count(*)`,
        tons: sql`coalesce(sum(${TONS}), 0)`,
        usd: sql`coalesce(sum(${money}), 0)`,
        onTime: sql`(${conditionCount(eq(order.arrivalOnTimeOffloading, true))})::float / count(*)`,
    };

    return [sql`${by[sort]} desc nulls last`, sql`${name} asc`, asc(id)];
};

/**
 * How many partners the ranking reaches down to. A directory this is not: the
 * tail of a ranking is noise, and the share each row carries says what is
 * missing from the bottom of it.
 */
const PARTNER_LIMIT = 100;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsRouter = createTRPCRouter({
    /**
     * The funnel and the attention counters behind the dashboard tiles, in one
     * grouped scan of what the tenant may see — so a tile always agrees with
     * the list it opens.
     *
     * Every stage is the tenant's own leg, except the first: a carrier's
     * prospects are the loads it was asked to quote, which is where its funnel
     * starts and the only place in this router an order it does not own is
     * counted.
     */
    pipeline: authorizedTenantProcedure("report", ["read"]).query(async ({ ctx }): Promise<AnalyticsPipeline> => {
        const tenant = scopeOf(ctx.tenant);
        const { organizationId: tenantId, orgType } = tenant;
        const shipper = orgType === "shipper";
        const own = tenantScope(kpiTenant(tenant));

        const [row] = await ctx.db
            .select({
                total: count(),
                prospects: conditionCount(eq(order.status, "prospect")),
                booked: stageCount("booked", tenant),
                onGoing: stageCount("on-going", tenant),
                delivered: stageCount("delivered", tenant),
                completed: conditionCount(and(own, eq(order.status, "completed"))!),
                cancelled: conditionCount(and(own, eq(order.status, "cancelled"))!),

                // Shipper: asked and still waiting for the first answer
                awaitingOffers: shipper
                    ? conditionCount(and(
                        eq(order.status, "prospect"),
                        sql`${pendingOfferCount} = 0`,
                        anyRequest(["requested"]),
                    )!)
                    : zeroCount,
                offersToReview: shipper
                    ? conditionCount(and(eq(order.status, "prospect"), sql`${pendingOfferCount} > 0`)!)
                    : zeroCount,
                newRequests: shipper ? zeroCount : conditionCount(myRequest(tenantId, ["requested"])),
                toDispatch: shipper
                    ? zeroCount
                    : conditionCount(and(
                        eq(order.carrierId, tenantId),
                        eq(order.status, "booked"),
                        isNull(order.driverId),
                    )!),
                onTheRoad: conditionCount(and(own, inArray(order.status, TRACKED_STATUSES))!),
                deliveredPending: shipper
                    ? conditionCount(and(
                        eq(order.status, "delivered"),
                        or(isNull(order.podStatus), inArray(order.podStatus, [...PENDING_POD_STATUSES])),
                    )!)
                    : conditionCount(and(own, eq(order.status, "delivered"))!),
            })
            .from(order)
            .where(visibleOrders(tenantId, orgType));

        return {
            total: row?.total ?? 0,
            sections: {
                prospects: row?.prospects ?? 0,
                booked: row?.booked ?? 0,
                onGoing: row?.onGoing ?? 0,
                delivered: row?.delivered ?? 0,
                completed: row?.completed ?? 0,
                cancelled: row?.cancelled ?? 0,
            },
            attention: {
                awaitingOffers: row?.awaitingOffers ?? 0,
                offersToReview: row?.offersToReview ?? 0,
                newRequests: row?.newRequests ?? 0,
                toDispatch: row?.toDispatch ?? 0,
                onTheRoad: row?.onTheRoad ?? 0,
                deliveredPending: row?.deliveredPending ?? 0,
            },
        };
    }),

    /**
     * The year's loads by month. Grouped on the expected loading date and
     * scoped by `order.year`, the same period every orders page uses, so the
     * bars agree with the lists behind them.
     */
    monthly: authorizedTenantProcedure("report", ["read"])
        .input(YearInput)
        .query(async ({ ctx, input }): Promise<AnalyticsMonthly> => {
            const tenant = kpiTenant(scopeOf(ctx.tenant));
            const chosen = input.year ?? currentYear();
            const month = sql<number>`extract(month from ${order.expectedLoadingDate})::int`.mapWith(Number);

            const rows = await ctx.db
                .select({
                    month,
                    orders: count(),
                    delivered: conditionCount(inArray(order.status, [...ARRIVED_STATUSES])),
                    tons: sumOf(TONS),
                })
                .from(order)
                .where(and(tenantScope(tenant), eq(order.year, chosen)))
                .groupBy(month);

            const counted = new Map(rows.map((row) => [row.month, row]));

            // Twelve entries whatever the data holds, so a quiet month is a gap
            // in the chart rather than a missing bar the axis shifts around
            return {
                year: chosen,
                months: Array.from({ length: 12 }, (_, index) => {
                    const row = counted.get(index + 1);

                    return {
                        month: `${chosen}-${String(index + 1).padStart(2, "0")}`,
                        orders: row?.orders ?? 0,
                        delivered: row?.delivered ?? 0,
                        tons: row?.tons ?? 0,
                    };
                }),
            };
        }),

    /**
     * The year's money on the tenant's own leg, per currency: what is still to
     * move, and what already did. A shipper reads what it owes and has paid, a
     * carrier what it is to receive and has received; currencies are never
     * added together, and the other side's leg is never selected at all.
     */
    money: authorizedTenantProcedure("report", ["read"])
        .input(YearInput)
        .query(async ({ ctx, input }): Promise<AnalyticsMoney> => {
            const tenant = scopeOf(ctx.tenant);
            const shipper = tenant.orgType === "shipper";
            const chosen = input.year ?? currentYear();
            // Quotes and lost orders were never owed, so no money view counts them
            const base = and(tenantScope(kpiTenant(tenant)), eq(order.year, chosen), billable())!;

            const own = shipper
                ? {
                    total: order.shipperTotal,
                    debit: order.shipperDebitTotal,
                    credit: order.shipperCreditTotal,
                    paid: order.shipperReceivedAmount,
                    status: order.shipperPaymentStatus,
                    currency: order.shipperCurrency,
                }
                : {
                    total: order.carrierTotal,
                    debit: order.carrierDebitTotal,
                    credit: order.carrierCreditTotal,
                    paid: order.carrierPaidAmount,
                    status: order.carrierPaymentStatus,
                    currency: order.carrierCurrency,
                };

            const legCurrency = currencyOf(own.currency);
            const insuranceCurrency = currencyOf(order.insuranceCurrency);

            const [legRows, insuranceRows] = await Promise.all([
                ctx.db
                    .select({
                        currency: legCurrency,
                        outstanding: outstandingOf(own.total, own.debit, own.credit, own.paid, own.status),
                        settled: sumOf(sql`coalesce(${own.paid}, 0)`),
                    })
                    .from(order)
                    .where(base)
                    .groupBy(legCurrency),

                // The premium is only ever the shipper's own when the shipper
                // is the one who took the cover out; Appload's own policies
                // come out of a commission the portal never shows
                shipper
                    ? ctx.db
                        .select({
                            currency: insuranceCurrency,
                            amount: sumOf(sql`coalesce(${order.insuranceValue}, 0)`),
                        })
                        .from(order)
                        .where(and(base, eq(order.insuranceSubscriber, "shipper"))!)
                        .groupBy(insuranceCurrency)
                    : [],
            ]);

            const lines = new Map<Currency, AnalyticsMoneyLine>();
            const line = (currency: string) => {
                const key = isCurrency(currency) ? currency : "MZN";
                const existing = lines.get(key);

                if (existing) return existing;

                const created = emptyLine(key);
                lines.set(key, created);

                return created;
            };

            for (const row of legRows) {
                const entry = line(row.currency);
                entry.outstanding += row.outstanding;
                entry.settled += row.settled;
            }

            for (const row of insuranceRows) {
                const entry = line(row.currency);
                entry.insurance = (entry.insurance ?? 0) + row.amount;
            }

            return {
                leg: shipper ? "shipper" : "carrier",
                byCurrency: CURRENCY.flatMap((currency) => {
                    const entry = lines.get(currency);

                    return entry && carries(entry) ? [entry] : [];
                }),
            };
        }),

    /**
     * The tenant's own KPI report over a period: the figures the staff page
     * prints for the same company, and the chart columns under them.
     *
     * The population is the analysed transports — everything billable loading
     * inside the period — and every leg is divided by the rate of its own
     * loading day, so a company invoicing in meticais, rand and dollars adds
     * up in USD without mixing two years of exchange rate into one number.
     */
    kpis: authorizedTenantProcedure("report", ["read"])
        .input(PeriodInput)
        .query(async ({ ctx, input }): Promise<AnalyticsKpis> => {
            const tenant = kpiTenant(scopeOf(ctx.tenant));
            const { from, to } = analyticsPeriod(input.period, input.year ?? currentYear());
            const type = tenant.orgType;
            const where = and(scope(type, from, to), tenantScope(tenant))!;
            const grain = bucketGrain(from, to);
            const columns = aggregate(type, { tenant });

            // The loading days in scope may include ones the seed script has
            // not caught up with; the top-up is bounded and never throws
            await topUpRates(ctx.db, where);

            // `date_trunc('week', …)` starts on the ISO Monday, which is what
            // `bucketStarts` enumerates — the two have to agree or the
            // zero-fill drops a column and invents an empty one beside it
            const start =
                grain === "month"
                    ? sql<string>`to_char(date_trunc('month', ${order.expectedLoadingDate}), 'YYYY-MM-DD')`
                    : sql<string>`to_char(date_trunc('week', ${order.expectedLoadingDate}), 'YYYY-MM-DD')`;

            const [totals, buckets] = await Promise.all([
                ctx.db
                    .select(columns)
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where),

                ctx.db
                    .select({
                        start,
                        transports: columns.transports,
                        tons: columns.tons,
                        km: columns.km,
                        onTimeOffloading: columns.onTimeOffloading,
                        travelDays: columns.travelDays,
                        travelDaysTrips: columns.travelDaysTrips,
                        total: columns.total,
                        unrated: columns.unrated,
                    })
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where)
                    .groupBy(start),
            ]);

            const counted = new Map(buckets.map((row) => [row.start, row]));

            return {
                period: { preset: input.period, from, to },
                // An aggregate without a group by always returns exactly one row
                figures: deriveKpis(type, totals[0]!),
                buckets: bucketStarts(from, to, grain).map((bucket): AnalyticsKpiBucket => {
                    const row = counted.get(bucket);

                    if (!row || row.transports === 0) {
                        return { start: bucket, transports: 0, tons: 0, km: 0, onTimeRate: null, averageDays: null, usd: null };
                    }

                    return {
                        start: bucket,
                        transports: row.transports,
                        tons: row.tons,
                        km: row.km,
                        onTimeRate: row.onTimeOffloading / row.transports,
                        // A duration is averaged over the trips that recorded
                        // one, never over all of them
                        averageDays: row.travelDaysTrips > 0 ? row.travelDays / row.travelDaysTrips : null,
                        // A bucket whose every transport went without a rate has
                        // no dollar figure; zero would read as a free trip
                        usd: row.unrated < row.transports ? row.total : null,
                    };
                }),
            };
        }),

    /**
     * The companies on the other side of the trade in the period, ranked.
     *
     * The rows are grouped by the counterparty while the money stays on the
     * tenant's own leg, so a carrier reading its per-client breakdown still
     * totals its own invoices and never sees what the client was charged. An
     * order with no carrier yet has no counterparty and is out of the ranking
     * altogether, shares included.
     */
    partners: authorizedTenantProcedure("report", ["read"])
        .input(PartnersInput)
        .query(async ({ ctx, input }): Promise<AnalyticsPartners> => {
            const tenant = kpiTenant(scopeOf(ctx.tenant));
            const { from, to } = analyticsPeriod(input.period, input.year ?? currentYear());
            const type = tenant.orgType;
            const other = leg(type === "shipper" ? "carrier" : "shipper");
            const mine = leg(type);
            const where = and(within(from, to), tenantScope(tenant), isNotNull(other.id))!;
            const columns = aggregate(type, { tenant, groupBy: "partner" });
            // The name on the order is the name at the time; the latest one labels the row
            const name = sql<string>`max(${other.name})`;

            await topUpRates(ctx.db, where);

            // The share divides by the period's own orders, not by the page:
            // a ranking that stopped at its limit would still have to say how
            // much of the year each row it did print is worth
            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select({
                        id: other.id,
                        name,
                        orders: columns.transports,
                        tons: columns.tons,
                        onTime: columns.onTimeOffloading,
                        usd: columns.total,
                        unrated: columns.unrated,
                    })
                    .from(order)
                    .leftJoinLateral(FX, sql`true`)
                    .where(where)
                    .groupBy(other.id)
                    .orderBy(...partnerOrder(input.sort, toUsd(mine.currency, mine.total), name, other.id))
                    .limit(PARTNER_LIMIT),

                ctx.db.select({ value: count() }).from(order).where(where),
            ]);

            const total = counted?.value ?? 0;

            return {
                sort: input.sort,
                rows: rows.flatMap((row): AnalyticsPartnerRow[] =>
                    row.id
                        ? [{
                            organizationId: row.id,
                            name: row.name,
                            orders: row.orders,
                            tons: row.tons,
                            onTimeRate: row.orders > 0 ? row.onTime / row.orders : null,
                            usd: row.unrated < row.orders ? row.usd : null,
                            share: total > 0 ? row.orders / total : 0,
                        }]
                        : [],
                ),
            };
        }),
});
