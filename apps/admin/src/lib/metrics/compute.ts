import type { Currency } from "@/frontend/pages/orders/types";
import {
    monthKey,
    PRESENTATION_CURRENCIES,
    type MetricMonth,
    type MetricsLifetime,
    type MetricsOverview,
    type MetricYear,
    type MoneyTotals,
    type MonthRate,
    type NativeAmounts,
    type NativeTotals,
    type PartyCount,
    type PartyCounts,
    type PresentationCurrency,
    type SheetMonth,
    type TripCounts,
} from "@/frontend/pages/metrics/types";

/**
 * The whole page's arithmetic, in one pure function.
 *
 * No I/O and no clock: the caller passes the months, the rates and which
 * month is "now", so every number here can be checked against the logbook
 * by hand. The definitions are the ones the old STATS sheet used — money is
 * each currency converted at *that month's* opening rate and added up, net
 * revenue is commission minus the VAT charged on it, margin is commission
 * over sales — with two deliberate differences, both of which the page states
 * in a footnote: per-trip figures divide by trips (the sheet divided sales by
 * deliveries), and shippers and carriers are counted once across a year's
 * orders (see logbook.ts) rather than summed month by month, which would
 * count the same client twelve times.
 *
 * Every figure is produced in both presentation currencies at once, dollars
 * and meticais, so the header toggle is a re-render rather than a refetch.
 * Both come from the same pinned rates: a metical figure is the dollar one
 * at that month's USD→MZN, and rand crosses through the dollar.
 */

export type ComputeInput = {
    months: SheetMonth[];
    /** One entry per month key on the timeline — `monthRates` never returns a partial map */
    rates: Record<string, MonthRate>;
    /** `YYYY-MM` in Maputo time: the month marked "to date" */
    currentMonth: string;
    /** Names counted once per month, year and lifetime, from the same orders */
    parties: PartyCounts;
};

const CURRENCIES: Currency[] = ["MZN", "ZAR", "USD"];

/** Money is carried to the cent; fifteen decimals of float noise only bloat the payload. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

const money = (value: number | null): number | null => (value === null ? null : round2(value));

/** Every ratio on this page is null rather than 0 when its divisor is empty. */
export const ratio = (numerator: number, divisor: number): number | null => (divisor > 0 ? numerator / divisor : null);

/** Year over year, as a fraction. Null when there is nothing to compare against. */
export const change = (current: number, previous: number): number | null =>
    previous === 0 ? null : (current - previous) / previous;

/** The sheet's conversion: each currency at the month's own rate, added up. */
export const toUsd = (amounts: NativeAmounts, rate: MonthRate): number =>
    amounts.MZN / rate.usdMzn + amounts.ZAR / rate.usdZar + amounts.USD;

/** The same money in meticais: dollars at the month's USD→MZN, rand through the dollar. */
export const toMzn = (amounts: NativeAmounts, rate: MonthRate): number =>
    amounts.MZN + (amounts.ZAR / rate.usdZar) * rate.usdMzn + amounts.USD * rate.usdMzn;

export const toMoney = (amounts: NativeAmounts, rate: MonthRate, currency: PresentationCurrency): number =>
    currency === "usd" ? toUsd(amounts, rate) : toMzn(amounts, rate);

/** The same conversion kept split by the currency the money was invoiced in. */
export const usdByCurrency = (amounts: NativeAmounts, rate: MonthRate): NativeAmounts => ({
    MZN: amounts.MZN / rate.usdMzn,
    ZAR: amounts.ZAR / rate.usdZar,
    USD: amounts.USD,
});

/** A span's money before the per-trip figures, which need the trip count. */
type Money = Omit<MoneyTotals, "salesPerTrip" | "commissionPerTrip">;

type MoneyByCurrency = Record<PresentationCurrency, Money>;

/** One month's money in one presentation currency, each native currency at the month's own rate. */
export function monthMoney(month: SheetMonth, rate: MonthRate, currency: PresentationCurrency): Money {
    const commission = toMoney(month.native.commission, rate, currency);
    const iva = toMoney(month.native.iva, rate, currency);

    return {
        sales: toMoney(month.native.sales, rate, currency),
        commission,
        net: commission - iva,
        iva,
        insurance: toMoney(month.native.insurance, rate, currency),
        prospects: toMoney(month.native.prospects, rate, currency),
    };
}

/** A month with everything derived from it, before any rounding. */
export type RawMonth = {
    key: string;
    sheet: SheetMonth;
    rate: MonthRate;
    money: MoneyByCurrency;
    /** USD-equivalent sales, kept split by origin currency for the mix chart */
    salesByCurrency: NativeAmounts;
};

/** Running totals over a set of months — a year, or the whole timeline. */
type Totals = {
    trips: TripCounts;
    deliveries: number;
    distanceKm: number;
    native: NativeTotals;
    money: MoneyByCurrency;
    salesByCurrency: NativeAmounts;
    /** Months with at least one trip */
    activeMonths: number;
    partial: boolean;
};

const zeroAmounts = (): NativeAmounts => ({ MZN: 0, ZAR: 0, USD: 0 });

const zeroMoney = (): Money => ({ sales: 0, commission: 0, net: 0, iva: 0, insurance: 0, prospects: 0 });

const MONEY_FIELDS = ["sales", "commission", "net", "iva", "insurance", "prospects"] as const;

const emptyTotals = (): Totals => ({
    trips: { national: 0, regional: 0, total: 0 },
    deliveries: 0,
    distanceKm: 0,
    native: {
        sales: zeroAmounts(),
        commission: zeroAmounts(),
        prospects: zeroAmounts(),
        insurance: zeroAmounts(),
        iva: zeroAmounts(),
    },
    money: { usd: zeroMoney(), mzn: zeroMoney() },
    salesByCurrency: zeroAmounts(),
    activeMonths: 0,
    partial: false,
});

function addAmounts(into: NativeAmounts, from: NativeAmounts): void {
    for (const currency of CURRENCIES) into[currency] += from[currency];
}

function addMoney(into: MoneyByCurrency, from: MoneyByCurrency): void {
    for (const currency of PRESENTATION_CURRENCIES) {
        for (const field of MONEY_FIELDS) into[currency][field] += from[currency][field];
    }
}

/**
 * Adds months up. Money is summed from the months rather than converted
 * from the native totals: every month carries its own rate, and that is the
 * point of the page.
 */
export function sumMonths(months: RawMonth[], partialKey: string): Totals {
    const totals = emptyTotals();

    for (const { key, sheet, money: monthly, salesByCurrency } of months) {
        totals.trips.national += sheet.trips.national;
        totals.trips.regional += sheet.trips.regional;
        totals.trips.total += sheet.trips.total;
        totals.deliveries += sheet.deliveries;
        totals.distanceKm += sheet.distanceKm;

        addAmounts(totals.native.sales, sheet.native.sales);
        addAmounts(totals.native.commission, sheet.native.commission);
        addAmounts(totals.native.prospects, sheet.native.prospects);
        addAmounts(totals.native.insurance, sheet.native.insurance);
        addAmounts(totals.native.iva, sheet.native.iva);

        addMoney(totals.money, monthly);
        addAmounts(totals.salesByCurrency, salesByCurrency);

        if (sheet.trips.total > 0) totals.activeMonths += 1;

        if (key === partialKey) totals.partial = true;
    }

    return totals;
}

/** Share of dollar sales by the currency they were invoiced in; all zero when there were none. */
export function currencyShare(salesByCurrency: NativeAmounts, total: number): Record<Currency, number> {
    if (total <= 0) return { MZN: 0, ZAR: 0, USD: 0 };

    return {
        MZN: salesByCurrency.MZN / total,
        ZAR: salesByCurrency.ZAR / total,
        USD: salesByCurrency.USD / total,
    };
}

/** The wire shape of a span's money: rounded, with the per-trip figures the span's trips allow. */
function presentMoney(byCurrency: MoneyByCurrency, trips: number): Record<PresentationCurrency, MoneyTotals> {
    const present = (spent: Money): MoneyTotals => ({
        sales: round2(spent.sales),
        commission: round2(spent.commission),
        net: round2(spent.net),
        iva: round2(spent.iva),
        insurance: round2(spent.insurance),
        prospects: round2(spent.prospects),
        salesPerTrip: money(ratio(spent.sales, trips)),
        commissionPerTrip: money(ratio(spent.commission, trips)),
    });

    return { usd: present(byCurrency.usd), mzn: present(byCurrency.mzn) };
}

/** The shape a year and the lifetime row share, with the money rounded for the wire. */
function summarise(totals: Totals, parties: PartyCount): MetricsLifetime {
    return {
        partial: totals.partial,
        trips: totals.trips,
        deliveries: totals.deliveries,
        distanceKm: round2(totals.distanceKm),
        activeMonths: totals.activeMonths,
        shippers: parties.shippers,
        carriers: parties.carriers,
        native: totals.native,
        money: presentMoney(totals.money, totals.trips.total),
        currencyShare: currencyShare(totals.salesByCurrency, totals.money.usd.sales),
        // A ratio of two figures converted at the same rates: the same in
        // either currency, so the dollar one stands for both
        margin: ratio(totals.money.usd.commission, totals.money.usd.sales),
    };
}

function toMetricMonth(raw: RawMonth, currentMonth: string): MetricMonth {
    const { sheet } = raw;

    return {
        key: raw.key,
        year: sheet.year,
        month: sheet.month,
        partial: raw.key === currentMonth,
        trips: sheet.trips,
        deliveries: sheet.deliveries,
        distanceKm: round2(sheet.distanceKm),
        shippers: sheet.shippers,
        carriers: sheet.carriers,
        native: sheet.native,
        rate: raw.rate,
        money: presentMoney(raw.money, sheet.trips.total),
        margin: ratio(raw.money.usd.commission, raw.money.usd.sales),
    };
}

/**
 * The previous year over the same calendar months. A year still running has
 * only reached September, so comparing it with twelve months of the year
 * before would print a collapse every January.
 */
function comparable(raw: RawMonth[], year: number, months: Set<number> | null): RawMonth[] {
    return raw.filter((month) => month.sheet.year === year && (months === null || months.has(month.sheet.month)));
}

/** Growth is read in dollars: the ratio barely moves with the currency, and one reading must not flip with the toggle. */
function yearOverYear(current: Totals, previous: Totals | null): MetricYear["yoy"] {
    if (!previous) {
        return { trips: null, sales: null, commission: null, net: null };
    }

    return {
        trips: change(current.trips.total, previous.trips.total),
        sales: change(current.money.usd.sales, previous.money.usd.sales),
        commission: change(current.money.usd.commission, previous.money.usd.commission),
        net: change(current.money.usd.net, previous.money.usd.net),
    };
}

/**
 * The timeline, its years and the lifetime row — everything `metrics.overview`
 * returns apart from the sheet metadata it is handed.
 */
export function computeOverview(input: ComputeInput): MetricsOverview {
    const raw: RawMonth[] = input.months.map((sheet) => {
        const key = monthKey(sheet.year, sheet.month);
        const rate = input.rates[key];

        if (!rate) {
            throw new Error(`[metrics] no exchange rate resolved for ${key}`);
        }

        return {
            key,
            sheet,
            rate,
            money: { usd: monthMoney(sheet, rate, "usd"), mzn: monthMoney(sheet, rate, "mzn") },
            salesByCurrency: usdByCurrency(sheet.native.sales, rate),
        };
    });

    const byYear = new Map<number, RawMonth[]>();

    for (const month of raw) {
        const bucket = byYear.get(month.sheet.year);

        if (bucket) {
            bucket.push(month);
        } else {
            byYear.set(month.sheet.year, [month]);
        }
    }

    const years: MetricYear[] = [...byYear.keys()]
        .sort((first, second) => first - second)
        .map((year) => {
            const months = byYear.get(year) ?? [];
            const totals = sumMonths(months, input.currentMonth);

            // A partial year is compared month for month; a complete one
            // against the whole of the year before
            const sameMonths = totals.partial ? new Set(months.map((month) => month.sheet.month)) : null;
            const before = comparable(raw, year - 1, sameMonths);

            return {
                year,
                ...summarise(totals, input.parties.years[year] ?? { shippers: 0, carriers: 0 }),
                yoy: yearOverYear(totals, before.length > 0 ? sumMonths(before, input.currentMonth) : null),
            };
        });

    return {
        months: raw.map((month) => toMetricMonth(month, input.currentMonth)),
        years,
        lifetime: summarise(sumMonths(raw, input.currentMonth), input.parties.lifetime),
        currentMonth: input.currentMonth,
    };
}
