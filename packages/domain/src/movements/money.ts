/**
 * The arithmetic of a movement's two legs and its cost lines.
 *
 * Client-safe and pure. Every figure carries its own currency and nothing
 * here ever adds two currencies together: a load bought in rand and sold in
 * meticais has two legs and no margin until somebody converts one of them,
 * and converting is the analytics page's job (at the loading day's rate),
 * never the detail page's.
 */

import type { MovementCostKind } from "@workspace/db/movements";
import type { CURRENCY, PAYMENT_STATUS } from "@workspace/db/types";

export type Currency = (typeof CURRENCY)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export type Amount = { amount: number; currency: Currency };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a leg's settlement stands, from its total and what has moved against
 * it. The same thresholds the order legs use (orders/payments.ts), restated
 * rather than imported: movements never go through the order door, and the
 * lint boundary on this folder says so.
 */
export function settlementStatus(total: number | null, settled: number): PaymentStatus {
    if (settled <= 0) return "pending";
    if (total === null || total <= 0) return "partially";
    return settled >= total ? "completed" : "partially";
}

/**
 * Whether a leg lets the movement close. A leg that was never priced has
 * nothing to settle — an internal run carries no sell leg, an own-fleet one
 * no buy leg — and counts as done.
 */
export const legSettled = (total: string | number | null, settlement: PaymentStatus | null): boolean =>
    total === null || settlement === "completed" || settlement === "not-applicable";

export type CostLine = {
    kind: MovementCostKind;
    amount: number;
    currency: Currency;
    rechargeable: boolean;
};

export type CostTotal = {
    currency: Currency;
    /** Everything spent in this currency */
    total: number;
    /** The part passed on to the client, which does not touch the margin */
    rechargeable: number;
};

/** Cost lines summed per currency — never across. */
export function costTotals(lines: readonly CostLine[]): CostTotal[] {
    const byCurrency = new Map<Currency, CostTotal>();

    for (const line of lines) {
        const bucket = byCurrency.get(line.currency) ?? { currency: line.currency, total: 0, rechargeable: 0 };
        bucket.total = round2(bucket.total + line.amount);
        if (line.rechargeable) bucket.rechargeable = round2(bucket.rechargeable + line.amount);
        byCurrency.set(line.currency, bucket);
    }

    return [...byCurrency.values()];
}

/**
 * What a leg is worth before VAT. VAT collected on a sale is owed to the
 * tax authority and VAT paid on a purchase is claimed back, so neither is
 * earnings — the same reason the order legs' commission is split by fiscal
 * regime (orders/commission.ts). A leg entered without its split falls back
 * to its total less whatever VAT it does carry.
 */
export const exVat = (leg: { subtotal: number | null; vat: number | null; total: number }): number =>
    leg.subtotal ?? Math.round((leg.total - (leg.vat ?? 0)) * 100) / 100;

export type Margin = {
    /** Sell minus buy; null when there is nothing to subtract or no common currency */
    gross: Amount | null;
    /** Gross minus the costs absorbed in that same currency */
    net: Amount | null;
    blocked: "CURRENCY_MISMATCH" | "MISSING_LEG" | null;
};

/**
 * What a load earned its owner, before VAT (callers pass `exVat` amounts).
 * An own-fleet load has no buy leg, so its gross is the sell leg and its
 * costs are the whole of what it cost to run; a partner load's gross is what
 * was charged less what was paid out.
 *
 * Cost lines are taken as entered: a fuel receipt has no VAT split on it, so
 * there is nothing honest to take off.
 *
 * Costs in another currency than the margin's are left out of `net` rather
 * than converted — the cost totals are returned beside it, so the page can
 * say which lines were not netted instead of silently dropping them.
 */
export function margin(input: {
    sell: Amount | null;
    buy: Amount | null;
    ownFleet: boolean;
    costs: readonly CostTotal[];
}): Margin {
    const { sell, buy, ownFleet, costs } = input;

    if (!sell) return { gross: null, net: null, blocked: "MISSING_LEG" };

    let gross: Amount;

    if (ownFleet) {
        gross = sell;
    } else {
        if (!buy) return { gross: null, net: null, blocked: "MISSING_LEG" };
        if (buy.currency !== sell.currency) return { gross: null, net: null, blocked: "CURRENCY_MISMATCH" };
        gross = { amount: round2(sell.amount - buy.amount), currency: sell.currency };
    }

    const absorbed = costs.find((cost) => cost.currency === gross.currency);
    const netted = absorbed ? round2(absorbed.total - absorbed.rechargeable) : 0;

    return {
        gross,
        net: { amount: round2(gross.amount - netted), currency: gross.currency },
        blocked: null,
    };
}
