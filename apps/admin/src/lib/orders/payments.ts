import type { DocumentParty, Order } from "@workspace/db/orders";

import { effectiveTotals } from "./totals";

/**
 * Proof-of-payment (POP) money math.
 *
 * A POP is an order_document row (type "proof-of-payment") whose `total` is
 * the amount paid for one party leg and whose `paidAt` is the bank value
 * date. A party leg is POP-GOVERNED once it has EVER had a POP (live or
 * voided) — from then on its paid columns are always re-derived from the
 * live proofs and never typed by hand. Legs without any POP keep the legacy
 * manual behaviour untouched.
 *
 * Client-safe and pure: the DB-facing sums live in payment-sums.ts.
 */

export const PROOF_OF_PAYMENT = "proof-of-payment" as const;

export const isProofOfPayment = (type: string): type is typeof PROOF_OF_PAYMENT =>
    type === PROOF_OF_PAYMENT;

export type PartyPaymentSums = {
    /** Ever had a POP (live or voided) — the governance flag */
    governed: boolean;
    /** Live (non-voided) proofs */
    liveCount: number;
    /** Σ live POP totals, rounded to cents */
    paidTotal: number;
    /** Latest paidAt over live proofs */
    lastPaidAt: Date | null;
};

export type PaymentSums = Record<DocumentParty, PartyPaymentSums>;

export const EMPTY_PARTY_SUMS: PartyPaymentSums = {
    governed: false,
    liveCount: 0,
    paidTotal: 0,
    lastPaidAt: null,
};

export const emptyPaymentSums = (): PaymentSums => ({
    shipper: { ...EMPTY_PARTY_SUMS },
    carrier: { ...EMPTY_PARTY_SUMS },
});

/**
 * The merged order state the derivation reads: stored row overlaid with
 * whatever the write is about to change (patched totals, the status being
 * written). Note sums never change inside an order write, so the stored
 * ones are always right here.
 */
export type PaymentState = Pick<
    Order,
    | "status"
    | "shipperTotal" | "carrierTotal" | "apploadCommissionTotal"
    | "shipperDebitTotal" | "shipperCreditTotal"
    | "carrierDebitTotal" | "carrierCreditTotal"
>;

/**
 * The per-party paid columns, keyed by party. Read from Appload's side the
 * shipper leg is money RECEIVED and the carrier leg money PAID, and the
 * columns are named that way — so the amount/percentage keys differ per
 * party while status/remaining/full-payment-date are symmetric.
 */
export const PAYMENT_KEYS = {
    shipper: {
        amount: "shipperReceivedAmount",
        percentage: "shipperReceivedPercentage",
        status: "shipperPaymentStatus",
        remainingAmount: "shipperRemainingAmount",
        remainingPercentage: "shipperRemainingPercentage",
        fullPaymentDate: "shipperFullPaymentDate",
    },
    carrier: {
        amount: "carrierPaidAmount",
        percentage: "carrierPaidPercentage",
        status: "carrierPaymentStatus",
        remainingAmount: "carrierRemainingAmount",
        remainingPercentage: "carrierRemainingPercentage",
        fullPaymentDate: "carrierFullPaymentDate",
    },
} as const satisfies Record<DocumentParty, Record<string, keyof Order>>;

type PaymentKey = (typeof PAYMENT_KEYS)[DocumentParty][keyof (typeof PAYMENT_KEYS)["shipper"]];

/** The six per-party paid columns a governed leg derives */
export type PaymentColumns = Pick<Order, PaymentKey>;

/** The columns a POP-governed leg no longer accepts by hand (per party) */
export const PAYMENT_LOCKED_KEYS = {
    shipper: [PAYMENT_KEYS.shipper.amount, PAYMENT_KEYS.shipper.status, PAYMENT_KEYS.shipper.fullPaymentDate],
    carrier: [PAYMENT_KEYS.carrier.amount, PAYMENT_KEYS.carrier.status, PAYMENT_KEYS.carrier.fullPaymentDate],
} as const satisfies Record<DocumentParty, readonly PaymentKey[]>;

export type PaymentLockedKey = (typeof PAYMENT_LOCKED_KEYS)[DocumentParty][number];

const round2 = (n: number) => Math.round(n * 100) / 100;
const decimal = (n: number) => String(n);

/**
 * Paid columns for POP-governed legs — always spread LAST in an order
 * write, after deriveOrderFields, so the recorded proofs beat both the
 * client patch and the legacy shortcuts (derivePayment's
 * "completed ⇒ 100/0/0", the booked "pending" scaffold).
 *
 * The patch is TOTAL for a governed leg: all six columns are written,
 * so nothing stale can survive underneath. Non-governed legs get nothing.
 *
 * Rules (T = effective total = base + debit − credit; p = Σ live proofs;
 * n = live proof count):
 *   T null/≤0, p = 0 → pending;   paid 0; ratios & remaining null
 *   T null/≤0, p > 0 → partially; paid p; ratios & remaining null
 *   T > 0,     p = 0 → pending;   paid 0; 0 % / T / 100 %
 *   T > 0, 0<p<T     → partially; p/T %, T−p, 100−p/T
 *   T > 0,     p ≥ T → completed; p/T % (may exceed 100), T−p (≤ 0, not
 *                      clamped — overpayment is accepted), fullPaymentDate =
 *                      latest paidAt
 * Status invariants win over money: a prospect is always "not-applicable"
 * (as derivePaymentStatus enforces); a cancelled/underbid order with nothing paid is
 * "not-applicable" too (not a receivable), with money paid it keeps
 * partially/completed.
 */
export function proofPaymentPatch(state: PaymentState, sums: PaymentSums): Partial<PaymentColumns> {
    const effective = effectiveTotals(state);
    const patch: Partial<PaymentColumns> = {};

    apply("shipper", effective.shipperTotal, sums.shipper);
    apply("carrier", effective.carrierTotal, sums.carrier);

    return patch;

    function apply(prefix: DocumentParty, total: number | null, party: PartyPaymentSums) {
        if (!party.governed) return;

        const keys = PAYMENT_KEYS[prefix];
        const paid = round2(party.paidTotal);
        // No meaningful denominator once notes net the total to zero
        const denominator = total !== null && total > 0 ? total : null;

        let status: NonNullable<Order["shipperPaymentStatus"]>;

        if (state.status === "prospect") {
            status = "not-applicable";
        } else if (paid <= 0) {
            status = state.status === "cancelled" || state.status === "underbid" ? "not-applicable" : "pending";
        } else if (denominator === null) {
            status = "partially";
        } else if (paid >= denominator) {
            status = "completed";
        } else {
            status = "partially";
        }

        patch[keys.amount] = decimal(paid);
        patch[keys.status] = status;
        patch[keys.fullPaymentDate] = status === "completed" ? party.lastPaidAt : null;

        if (denominator === null) {
            patch[keys.percentage] = null;
            patch[keys.remainingAmount] = null;
            patch[keys.remainingPercentage] = null;
            return;
        }

        const paidPercentage = round2((paid / denominator) * 100);

        patch[keys.percentage] = decimal(paidPercentage);
        patch[keys.remainingAmount] = decimal(round2(denominator - paid));
        patch[keys.remainingPercentage] = decimal(round2(100 - paidPercentage));
    }
}

/**
 * Parties whose manual paid fields a patch would CHANGE (unchanged echoes
 * of the stored values are ignored, like changedCurrencyParties). Used by
 * order.update to reject hand edits on POP-governed legs.
 */
export function changedPaymentParties(
    patch: Partial<Record<PaymentLockedKey, unknown>>,
    current: PaymentColumns,
): DocumentParty[] {
    const norm = (value: unknown): string | null => {
        if (value === undefined || value === null || value === "") return null;
        if (value instanceof Date) return String(value.getTime());
        if (typeof value === "number") return String(value);
        const asNumber = Number(value);
        return Number.isFinite(asNumber) && String(value).trim() !== "" ? String(asNumber) : String(value);
    };

    const changed = (party: DocumentParty) =>
        PAYMENT_LOCKED_KEYS[party].some((key) => {
            const patched = patch[key];
            if (patched === undefined) return false;
            return norm(patched) !== norm(current[key]);
        });

    return (["shipper", "carrier"] as const).filter(changed);
}

/** Africa/Maputo has no DST: a fixed UTC+2 is exact, same as the tracking cron */
const MAPUTO_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The calendar day (UTC midnight) a Date falls on in Africa/Maputo */
export function maputoCalendarDay(at: Date): Date {
    const shifted = new Date(at.getTime() + MAPUTO_OFFSET_MS);
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/**
 * A payment date is stored as UTC midnight of its calendar day and may not
 * be later than today's calendar day in Africa/Maputo — the sheet formats
 * it in UTC and the UI in CAT, and both stay on the same day.
 */
export function isFuturePaymentDate(paidAt: Date, now: Date = new Date()): boolean {
    return maputoCalendarDay(paidAt).getTime() > maputoCalendarDay(now).getTime();
}
