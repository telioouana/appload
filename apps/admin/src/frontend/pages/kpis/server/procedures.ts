import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, countDistinct, desc, eq, ilike, sql } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { deriveKpis } from "@workspace/domain/kpis/compute";
import {
    FX,
    aggregate,
    escapeLike,
    leg,
    partyOrder,
    scope,
    topUpRates,
    within,
} from "@workspace/domain/kpis/sql";
import { KPI_SORTS, PARTY_TYPES, bucketGrain, bucketStarts } from "@/frontend/pages/kpis/types";
import type {
    KpiBucket,
    KpiPartyOption,
    KpiPartyRow,
    KpiReport,
    KpiStats,
} from "@/frontend/pages/kpis/types";
import type { PagedResult } from "@/frontend/pages/partners/types";

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
 * The heavy lifting is SQL on purpose, and it lives in
 * `@workspace/domain/kpis/sql` so the portal counts with the same fragments.
 * One pass returns counts and sums only; `deriveKpis` does every division
 * afterwards, in a pure function that can be checked against the sheet by hand.
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
