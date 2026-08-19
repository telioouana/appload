import type { Order } from "@workspace/db/orders";

/**
 * Effective money math for debit/credit notes.
 *
 * Base totals on the order row stay canonical (what was booked); the live
 * note sums are materialized next to them (shipper/carrier debit/credit
 * totals, rebuildable from order_document). Business rules:
 * - effective total = base + debit − credit, per party
 * - effective commission uses debit notes only — credit notes never touch
 *   Appload's commission
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const toNumber = (value: string | null) => (value === null ? null : Number(value));

type MoneyColumns = Pick<
    Order,
    | "shipperTotal" | "carrierTotal" | "apploadCommissionTotal"
    | "shipperDebitTotal" | "shipperCreditTotal"
    | "carrierDebitTotal" | "carrierCreditTotal"
>;

export function effectiveTotals(order: MoneyColumns): {
    shipperTotal: number | null;
    carrierTotal: number | null;
} {
    const shipperBase = toNumber(order.shipperTotal);
    const carrierBase = toNumber(order.carrierTotal);

    return {
        shipperTotal: shipperBase === null
            ? null
            : round2(shipperBase + Number(order.shipperDebitTotal) - Number(order.shipperCreditTotal)),
        carrierTotal: carrierBase === null
            ? null
            : round2(carrierBase + Number(order.carrierDebitTotal) - Number(order.carrierCreditTotal)),
    };
}

export function effectiveCommission(order: MoneyColumns): number | null {
    const shipperBase = toNumber(order.shipperTotal);
    const carrierBase = toNumber(order.carrierTotal);

    if (shipperBase === null || carrierBase === null) {
        return toNumber(order.apploadCommissionTotal);
    }

    return round2(
        (shipperBase + Number(order.shipperDebitTotal)) -
        (carrierBase + Number(order.carrierDebitTotal)),
    );
}

/**
 * A copy of the row with the money columns replaced by their effective
 * values — the one integration point for the sheet sync and the PDF
 * templates, which read plain rows.
 */
export function withEffectiveTotals<T extends MoneyColumns>(order: T): T {
    const { shipperTotal, carrierTotal } = effectiveTotals(order);
    const commission = effectiveCommission(order);

    return {
        ...order,
        shipperTotal: shipperTotal === null ? order.shipperTotal : String(shipperTotal),
        carrierTotal: carrierTotal === null ? order.carrierTotal : String(carrierTotal),
        apploadCommissionTotal: commission === null ? order.apploadCommissionTotal : String(commission),
    };
}

/**
 * Re-derives the outstanding-payment columns from the effective totals and
 * the recorded paid amounts — applied when a note lands or is voided, so
 * "remaining" always means what is actually still owed.
 */
export function remainingPatch(order: Order): Partial<Order> {
    const { shipperTotal, carrierTotal } = effectiveTotals(order);
    const patch: Partial<Order> = {};

    const apply = (
        prefix: "shipper" | "carrier",
        total: number | null,
        paymentStatus: Order["shipperPaymentStatus"],
        paidAmount: string | null,
    ) => {
        if (total === null || total <= 0 || paymentStatus === "completed" || paymentStatus === "not-applicable") {
            return;
        }

        const paid = Number(paidAmount ?? 0);
        const paidPercentage = round2((paid / total) * 100);

        patch[`${prefix}RemainingAmount`] = String(round2(total - paid));
        patch[`${prefix}RemainingPercentage`] = String(round2(100 - paidPercentage));
        // The shipper leg is money received, the carrier leg money paid —
        // the ratio columns are named accordingly
        if (prefix === "shipper") {
            patch.shipperReceivedPercentage = String(paidPercentage);
        } else {
            patch.carrierPaidPercentage = String(paidPercentage);
        }
    };

    apply("shipper", shipperTotal, order.shipperPaymentStatus, order.shipperReceivedAmount);
    apply("carrier", carrierTotal, order.carrierPaymentStatus, order.carrierPaidAmount);

    return patch;
}
