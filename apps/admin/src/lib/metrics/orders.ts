import type { db as Database } from "@workspace/db/db";
import { order, type Order } from "@workspace/db/orders";
import { effectiveCommission, effectiveTotals } from "@workspace/domain/orders/totals";

import { monthKey, type NativeAmounts, type PartyCount, type PartyCounts, type SheetMonth } from "@/frontend/pages/metrics/types";

/**
 * The admin's orders folded into the months the page draws.
 *
 * The database is the record: the logbook only mirrors it, so the page reads
 * the same rows the orders pages list. Money is the effective total — the
 * base plus debit notes, less credit notes — the value the sheet sync writes
 * into the logbook, so a month here and the same month in the sheet agree.
 *
 * Definitions, kept the way the old STATS sheet counted so the years read
 * the same: a trip is any order that ran (not cancelled, underbid or a
 * prospect), placed in the month of its expected loading date; sales are the
 * shipper's invoice total in its currency; commission is Appload's commission
 * total in the same currency, with its VAT beside it; prospects are the
 * commission of the orders still being quoted; insurance is the value of the
 * policies Appload subscribed; shippers and carriers are organizations,
 * counted once however many loads they moved — per month, per year and over
 * the whole timeline.
 */

type Db = typeof Database;

/** The columns the fold reads, and nothing else — the whole table is walked. */
const COLUMNS = {
    status: order.status,
    route: order.route,
    expectedLoadingDate: order.expectedLoadingDate,
    deliveries: order.deliveries,
    distance: order.distance,
    shipperId: order.shipperId,
    carrierId: order.carrierId,
    shipperCurrency: order.shipperCurrency,
    shipperTotal: order.shipperTotal,
    carrierTotal: order.carrierTotal,
    apploadCommissionTotal: order.apploadCommissionTotal,
    apploadCommissionVAT: order.apploadCommissionVAT,
    shipperDebitTotal: order.shipperDebitTotal,
    shipperCreditTotal: order.shipperCreditTotal,
    carrierDebitTotal: order.carrierDebitTotal,
    carrierCreditTotal: order.carrierCreditTotal,
    insuranceSubscriber: order.insuranceSubscriber,
    insuranceValue: order.insuranceValue,
    insuranceCurrency: order.insuranceCurrency,
};

export type OrderRow = Pick<Order, keyof typeof COLUMNS>;

// ponytail: every order in one read, folded in memory; a GROUP BY month when the table outgrows that
export const readOrderRows = (db: Db): Promise<OrderRow[]> => db.select(COLUMNS).from(order);

/** What one month's rows fold into, plus the organizations seen in them. */
type Bucket = { month: SheetMonth; names: Names };
type Names = { shippers: Set<string>; carriers: Set<string> };

export type OrdersAggregate = {
    /** Every month with at least one order, oldest first, not contiguous — see timeline() */
    months: SheetMonth[];
    parties: PartyCounts;
};

const zeroAmounts = (): NativeAmounts => ({ MZN: 0, ZAR: 0, USD: 0 });

export const emptyMonth = (year: number, month: number): SheetMonth => ({
    year,
    month,
    trips: { national: 0, regional: 0, total: 0 },
    deliveries: 0,
    distanceKm: 0,
    shippers: 0,
    carriers: 0,
    native: {
        sales: zeroAmounts(),
        commission: zeroAmounts(),
        prospects: zeroAmounts(),
        insurance: zeroAmounts(),
        iva: zeroAmounts(),
    },
});

const newNames = (): Names => ({ shippers: new Set(), carriers: new Set() });

const toCount = (names: Names): PartyCount => ({ shippers: names.shippers.size, carriers: names.carriers.size });

/** A numeric column as a number; null (never entered) counts as nothing. */
const num = (value: string | number | null): number => Number(value ?? 0) || 0;

/**
 * Rows in, months out. Pure, so every figure on the page can be checked
 * against the orders pages with a filter.
 */
export function aggregateOrders(rows: OrderRow[]): OrdersAggregate {
    const buckets = new Map<string, Bucket>();
    const years = new Map<number, Names>();
    const lifetime = newNames();

    const bucketFor = (year: number, month: number): Bucket => {
        const key = monthKey(year, month);
        let bucket = buckets.get(key);

        if (!bucket) {
            bucket = { month: emptyMonth(year, month), names: newNames() };
            buckets.set(key, bucket);
        }

        return bucket;
    };

    for (const row of rows) {
        // Cancelled and underbid orders never ran: no trip, no money, no name
        if (row.status === "cancelled" || row.status === "underbid") continue;

        // Naive-UTC timestamps: the UTC month is the month ops typed, the
        // one the dashboard's extract(month …) reads too
        const year = row.expectedLoadingDate.getUTCFullYear();
        const month = row.expectedLoadingDate.getUTCMonth() + 1;
        const { month: totals, names } = bucketFor(year, month);
        const invoiced = row.shipperCurrency ?? "MZN";
        const commission = effectiveCommission(row) ?? 0;

        // A prospect is pipeline, not a trip: only its commission counts,
        // and only under "prospects"
        if (row.status === "prospect") {
            totals.native.prospects[invoiced] += commission;

            continue;
        }

        totals.trips.total += 1;
        totals.trips[row.route] += 1;

        totals.deliveries += num(row.deliveries);
        totals.distanceKm += num(row.distance);

        totals.native.sales[invoiced] += effectiveTotals(row).shipperTotal ?? 0;
        totals.native.commission[invoiced] += commission;
        totals.native.iva[invoiced] += num(row.apploadCommissionVAT);

        // Only the policies Appload took out are Appload's cost; a client's
        // own insurance (or none) is not money on this page
        if (row.insuranceSubscriber === "appload") {
            totals.native.insurance[row.insuranceCurrency ?? invoiced] += num(row.insuranceValue);
        }

        const inYear = years.get(year) ?? newNames();

        years.set(year, inYear);

        names.shippers.add(row.shipperId);
        inYear.shippers.add(row.shipperId);
        lifetime.shippers.add(row.shipperId);

        if (row.carrierId) {
            names.carriers.add(row.carrierId);
            inYear.carriers.add(row.carrierId);
            lifetime.carriers.add(row.carrierId);
        }
    }

    const keys = [...buckets.keys()].sort();
    const parties: PartyCounts = { months: {}, years: {}, lifetime: toCount(lifetime) };

    for (const key of keys) {
        const bucket = buckets.get(key)!;
        const count = toCount(bucket.names);

        bucket.month.shippers = count.shippers;
        bucket.month.carriers = count.carriers;
        parties.months[key] = count;
    }

    for (const [year, names] of years) parties.years[year] = toCount(names);

    return {
        months: keys.map((key) => buckets.get(key)!.month),
        parties,
    };
}

/** Anything at all happened: a trip ran, or money was invoiced. */
function hasActivity(month: SheetMonth): boolean {
    const { sales, commission } = month.native;
    const money = sales.MZN + sales.ZAR + sales.USD + commission.MZN + commission.ZAR + commission.USD;

    return month.trips.total > 0 || money > 0;
}

/**
 * The months the orders fall in, cut down to the timeline the page draws:
 * from the first month Appload traded to the current Maputo month,
 * contiguous, with the quiet months in between filled in so a chart's x-axis
 * never skips one. An order dated in the future (a booking for next month)
 * is left for the month to arrive.
 */
export function timeline(rows: SheetMonth[], currentMonth: string): SheetMonth[] {
    const byKey = new Map<string, SheetMonth>();

    for (const row of rows) {
        const key = monthKey(row.year, row.month);

        if (key <= currentMonth) byKey.set(key, row);
    }

    const keys = [...byKey.keys()].sort();
    const first = keys.find((key) => hasActivity(byKey.get(key)!));

    if (!first) return [];

    const months: SheetMonth[] = [];
    let year = Number(first.slice(0, 4));
    let month = Number(first.slice(5));

    for (let key = first; key <= currentMonth; key = monthKey(year, month)) {
        months.push(byKey.get(key) ?? emptyMonth(year, month));

        if (month === 12) {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }

    return months;
}
