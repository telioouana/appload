import { normalize } from "@/lib/orders/orders-sheet-mapping";
import { monthKey, type NativeAmounts, type PartyCount, type PartyCounts, type SheetMonth } from "@/frontend/pages/metrics/types";
import type { Currency } from "@/frontend/pages/orders/types";

/**
 * The logbook's ORDERS rows folded into the months the page draws.
 *
 * One row per order: the columns the app writes (orders-sheet-mapping.ts)
 * beside the accountant's hand-entered money and the sheet's own formula
 * columns (commission, VAT). Pure — rows in, months out — so every figure on
 * the page can be checked against the logbook with a filter.
 *
 * Definitions, kept the way the old STATS sheet counted so the years read
 * the same: a trip is any order that ran (not cancelled, underbid or a
 * prospect), placed in the month of its expected loading date (the actual
 * date, then the arrival, when that is blank — an order with no date at all
 * is not on the timeline); sales are the shipper's invoice total in its
 * currency; commission is Appload's commission total in the same currency,
 * with its VAT beside it; prospects are the commission of the orders still
 * being quoted; insurance is the value of the policies Appload subscribed;
 * shippers and carriers are names, counted once however many loads they
 * moved — per month, per year and over the whole timeline.
 */

export const LOGBOOK_SHEET = "ORDERS";
// Header on row 2 (row 1 is the table's title band); CZ is the last column the sheet fills
export const LOGBOOK_RANGE = "A2:CZ";

// Sheets counts days from 1899-12-30, so 25569 is the Unix epoch
export const SERIAL_EPOCH = 25569;
export const DAY_MS = 86_400_000;

/**
 * The columns this reads, by header text (resolved with normalize, so the
 * sheet's own spelling — "Comission", "Insuerance" — is matched as it is).
 */
const HEADERS = {
    shipper: "Shipper",
    carrier: "Carrier",
    status: "Status",
    route: "Route",
    expectedLoading: "Expected Loading Date",
    actualLoading: "Actual Loading Date",
    arrivalAtLoading: "Arrival at Loading",
    deliveries: "Deliveries",
    distance: "Distance",
    salesTotal: "Shipper Invoice Total",
    salesCurrency: "Shipper Invoice Currency",
    commissionTotal: "Appload Comission Total",
    commissionVat: "Appload Comission VAT",
    insuranceSubscriber: "Insuerance Subscriber",
    insuranceValue: "Insurance Value",
    insuranceCurrency: "Insurance Currency",
} as const;

type ColumnKey = keyof typeof HEADERS;

/** Orders that never ran — the dropdown labels the app writes for those statuses. */
const LOST = new Set(["cancelled", "underbid"]);
const PROSPECT = "prospects";
const APPLOAD = "appload";

const CURRENCIES: readonly Currency[] = ["MZN", "ZAR", "USD"];

/** What one month's rows fold into, plus the names seen in them. */
type Bucket = { month: SheetMonth; names: Names };
type Names = { shippers: Set<string>; carriers: Set<string> };

export type LogbookAggregate = {
    /** Every month with at least one dated order, oldest first, not contiguous — see timeline() */
    months: SheetMonth[];
    parties: PartyCounts;
    /** Orders skipped for carrying no loading date at all */
    undated: number;
};

/** Serials are whole days counted in UTC, so the month is read in UTC too. */
export function serialToMonth(serial: number): { year: number; month: number } {
    const at = new Date((serial - SERIAL_EPOCH) * DAY_MS);

    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
}

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

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const num = (value: unknown): number => (finite(value) ? value : 0);

/**
 * The currency a cell names, or the fallback. An empty cell is the app's own
 * default (MZN) on the eight rows that predate the column; anything else
 * unrecognised is a typo the money should not vanish over.
 */
function currency(value: unknown, fallback: Currency = "MZN"): Currency {
    const code = String(value ?? "").trim().toUpperCase();

    return (CURRENCIES as readonly string[]).includes(code) ? (code as Currency) : fallback;
}

function resolveColumns(header: unknown[]): Record<ColumnKey, number> {
    const positions = new Map<string, number>();

    header.forEach((cell, index) => {
        const key = normalize(String(cell ?? ""));

        // Leftmost wins, should a label ever repeat further right
        if (key && !positions.has(key)) positions.set(key, index);
    });

    const columns = {} as Record<ColumnKey, number>;

    for (const [key, label] of Object.entries(HEADERS) as [ColumnKey, string][]) {
        const index = positions.get(normalize(label));

        if (index === undefined) {
            throw new Error(`[metrics] logbook header "${label}" not found on the ${LOGBOOK_SHEET} tab`);
        }

        columns[key] = index;
    }

    return columns;
}

/**
 * Rows in, months out. The first row is the header; every other row is one
 * order, and an order lands in exactly one month or nowhere.
 */
export function aggregateLogbook(rows: unknown[][]): LogbookAggregate {
    const [header, ...body] = rows;

    if (!header) {
        throw new Error(`[metrics] the logbook's ${LOGBOOK_SHEET} tab returned no header row`);
    }

    const columns = resolveColumns(header);
    const buckets = new Map<string, Bucket>();
    const years = new Map<number, Names>();
    const lifetime = newNames();
    let undated = 0;

    const bucketFor = (year: number, month: number): Bucket => {
        const key = monthKey(year, month);
        let bucket = buckets.get(key);

        if (!bucket) {
            bucket = { month: emptyMonth(year, month), names: newNames() };
            buckets.set(key, bucket);
        }

        return bucket;
    };

    for (const row of body) {
        const cell = (key: ColumnKey) => row[columns[key]];
        const status = normalize(String(cell("status") ?? ""));

        // Cancelled and underbid orders never ran: no trip, no money, no name
        if (LOST.has(status)) continue;

        // The expected loading date is the period every orders page uses;
        // the two fallbacks cover rows entered before the column existed
        const serial = [cell("expectedLoading"), cell("actualLoading"), cell("arrivalAtLoading")].find(finite);

        if (serial === undefined) {
            undated += 1;

            continue;
        }

        const { year, month } = serialToMonth(serial);
        const { month: totals, names } = bucketFor(year, month);
        const invoiced = currency(cell("salesCurrency"));
        const commission = num(cell("commissionTotal"));

        // A prospect is pipeline, not a trip: only its commission counts,
        // and only under "prospects"
        if (status === PROSPECT) {
            totals.native.prospects[invoiced] += commission;

            continue;
        }

        const route = normalize(String(cell("route") ?? ""));

        totals.trips.total += 1;
        if (route === "national") totals.trips.national += 1;
        if (route === "regional") totals.trips.regional += 1;

        totals.deliveries += num(cell("deliveries"));
        totals.distanceKm += num(cell("distance"));

        totals.native.sales[invoiced] += num(cell("salesTotal"));
        totals.native.commission[invoiced] += commission;
        totals.native.iva[invoiced] += num(cell("commissionVat"));

        // Only the policies Appload took out are Appload's cost; a client's
        // own insurance (or none) is not money on this page
        if (normalize(String(cell("insuranceSubscriber") ?? "")) === APPLOAD) {
            totals.native.insurance[currency(cell("insuranceCurrency"), invoiced)] += num(cell("insuranceValue"));
        }

        const shipper = normalize(String(cell("shipper") ?? ""));
        const carrier = normalize(String(cell("carrier") ?? ""));
        const inYear = years.get(year) ?? newNames();

        years.set(year, inYear);

        if (shipper) {
            names.shippers.add(shipper);
            inYear.shippers.add(shipper);
            lifetime.shippers.add(shipper);
        }

        if (carrier) {
            names.carriers.add(carrier);
            inYear.carriers.add(carrier);
            lifetime.carriers.add(carrier);
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
        undated,
    };
}
