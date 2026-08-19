import type { CreateOrder, Order } from "@workspace/db/orders";

import type { UpdateOrderForm } from "@/backend/schemas/order";

/**
 * Derived order columns, computed on every update from the merged state
 * (existing row overlaid with the patch). These fields are not editable in
 * the update form — see updateFields in @/backend/schemas/order:
 * - arrivalOnTime* : arrived on the same calendar day or earlier than the
 *   proposed date (falling back to the expected date)
 * - daysSpend(Loading|Offloading): working time, actual date -> departure
 * - demurrageAt(Loading|Offloading): waiting time (arrival -> actual) > 2 days
 * - daysSpendAtBorder / demurrageAtBorder: arrival -> departure, same 2-day rule
 * - daysSpendTraveling: departure from loading -> arrival at offloading
 * - dealDate: stamped once the order reaches booked (or any later stage)
 * - loadedWeight / offloadedWeight: default to @weight when still empty on
 *   on-route / completed
 * - paid & remaining percentages/amounts: from paid amount vs total whenever
 *   a paid amount is recorded; payment status "completed" forces 100 / 0 / 0
 * - carrier/shipper payment status: prospect forces "not-applicable"; booked
 *   upgrades null/"not-applicable" to "pending" but never downgrades a status
 *   already at "partially" or "completed"
 * - money chain (only when the patch touches route / fiscalRegime / an
 *   amount): VAT and subtotal re-derive from the kept VAT-inclusive total
 *   (shipper VAT keyed on route = national, carrier VAT on regime = normal),
 *   then commission = shipperTotal - carrierTotal with the same VAT rules
 *   the create form applies
 */

const DAY_MS = 86_400_000;
const DEMURRAGE_FREE_DAYS = 2;

// Mozambican VAT extracted from a VAT-inclusive total: total * (0.16/1.16)
const VAT_RATE = 0.16 / 1.16;

// Calendar-day math: compare dates by day, ignoring the time of day
const dayStart = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.max(0, Math.round((dayStart(to) - dayStart(from)) / DAY_MS));
const onOrBefore = (arrival: Date, reference: Date) => dayStart(arrival) <= dayStart(reference);

const round2 = (n: number) => Math.round(n * 100) / 100;
const decimal = (n: number) => String(n);
const toNumber = (value: string | null) => (value === null ? null : Number(value));

// Payment math runs against the EFFECTIVE total (base + debit notes −
// credit notes): "remaining" means what is actually still owed
const adjustedTotal = (base: number | null, debit: string, credit: string) =>
    base === null ? null : round2(base + Number(debit) - Number(credit));

// Every status from booked onwards implies the deal was closed; prospect and
// cancelled/underbid orders never get a deal date stamped
const DEAL_CLOSED_STATUSES = new Set<Order["status"]>([
    "booked", "to-loading", "at-loading", "loading", "waiting-documents",
    "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading",
    "delivered", "completed",
]);

type PaymentStatusValue = Order["carrierPaymentStatus"];

/**
 * The status-driven payment-status rule, shared by create and update:
 * prospect → "not-applicable"; booked → "pending" only when nothing more
 * advanced was set; any other status leaves the value untouched.
 */
export function derivePaymentStatus(
    status: Order["status"],
    current: PaymentStatusValue,
): NonNullable<PaymentStatusValue> | undefined {
    if (status === "prospect") {
        return "not-applicable";
    }
    if (status === "booked" && (current === null || current === "not-applicable")) {
        return "pending";
    }
    return undefined;
}

type PaymentDerived = {
    paidPercentage: string;
    remainingAmount: string;
    remainingPercentage: string;
};

function derivePayment(
    paidAmount: number | null,
    total: number | null,
    paymentStatus: string | null,
): PaymentDerived | undefined {
    if (paymentStatus === "completed") {
        return { paidPercentage: "100", remainingAmount: "0", remainingPercentage: "0" };
    }

    // The payment status already says whether a payment is partial; any
    // recorded amount against a known total derives the ratios
    if (paidAmount === null || total === null || total <= 0) {
        return undefined;
    }

    const paidPercentage = round2((paidAmount / total) * 100);

    return {
        paidPercentage: decimal(paidPercentage),
        remainingAmount: decimal(round2(total - paidAmount)),
        remainingPercentage: decimal(round2(100 - paidPercentage)),
    };
}

export function deriveOrderFields(current: Order, patch: UpdateOrderForm): Partial<CreateOrder> {
    // Merged view: a patched value wins, otherwise the stored one
    const pick = <T>(patched: T | undefined, stored: T | null): T | null =>
        patched !== undefined ? patched : stored;

    const derived: Partial<CreateOrder> = {};

    /**
     * Loading
     */
    const expectedLoading = pick(patch.expectedLoadingDate, current.expectedLoadingDate);
    const proposedLoading = pick(patch.proposedLoadingDate, current.proposedLoadingDate);
    const arrivalLoading = pick(patch.arrivalAtLoading, current.arrivalAtLoading);
    const actualLoading = pick(patch.actualLoadingDate, current.actualLoadingDate);
    const departureLoading = pick(patch.departureLoadingDate, current.departureLoadingDate);

    const loadingReference = proposedLoading ?? expectedLoading;
    if (arrivalLoading && loadingReference) {
        derived.arrivalOnTimeLoading = onOrBefore(arrivalLoading, loadingReference);
    }
    if (actualLoading && departureLoading) {
        derived.daysSpendLoading = daysBetween(actualLoading, departureLoading);
    }
    if (arrivalLoading && actualLoading) {
        derived.demurrageAtLoading = daysBetween(arrivalLoading, actualLoading) > DEMURRAGE_FREE_DAYS;
    }

    /**
     * Offloading
     */
    const expectedOffloading = pick(patch.expectedOffloadingDate, current.expectedOffloadingDate);
    const proposedOffloading = pick(patch.proposedOffloadingDate, current.proposedOffloadingDate);
    const arrivalOffloading = pick(patch.arrivalAtOffloading, current.arrivalAtOffloading);
    const actualOffloading = pick(patch.actualOffloadingDate, current.actualOffloadingDate);
    const departureOffloading = pick(patch.departureOffloadingDate, current.departureOffloadingDate);

    const offloadingReference = proposedOffloading ?? expectedOffloading;
    if (arrivalOffloading && offloadingReference) {
        derived.arrivalOnTimeOffloading = onOrBefore(arrivalOffloading, offloadingReference);
    }
    if (actualOffloading && departureOffloading) {
        derived.daysSpendOffloading = daysBetween(actualOffloading, departureOffloading);
    }
    if (arrivalOffloading && actualOffloading) {
        derived.demurrageAtOffloading = daysBetween(arrivalOffloading, actualOffloading) > DEMURRAGE_FREE_DAYS;
    }

    /**
     * Border
     */
    const arrivalBorder = pick(patch.arrivalAtBorder, current.arrivalAtBorder);
    const departureBorder = pick(patch.departureFromBorder, current.departureFromBorder);

    if (arrivalBorder && departureBorder) {
        const daysAtBorder = daysBetween(arrivalBorder, departureBorder);
        derived.daysSpendAtBorder = daysAtBorder;
        derived.demurrageAtBorder = daysAtBorder > DEMURRAGE_FREE_DAYS;
    }

    /**
     * Traveling
     */
    if (departureLoading && arrivalOffloading) {
        derived.daysSpendTraveling = daysBetween(departureLoading, arrivalOffloading);
    }

    /**
     * Status-driven fields
     */
    const status = patch.status ?? current.status;

    if (DEAL_CLOSED_STATUSES.has(status) && current.dealDate === null) {
        derived.dealDate = new Date();
    }

    const weight = patch.weight !== undefined ? patch.weight : Number(current.weight);
    const loadedWeight = pick(patch.loadedWeight, toNumber(current.loadedWeight));
    const offloadedWeight = pick(patch.offloadedWeight, toNumber(current.offloadedWeight));

    if (status === "on-route" && loadedWeight === null) {
        derived.loadedWeight = decimal(weight);
    }
    if (status === "completed" && offloadedWeight === null) {
        derived.offloadedWeight = decimal(weight);
    }

    /**
     * Payments
     */
    const carrierPaymentStatus = derivePaymentStatus(
        status,
        pick(patch.carrierPaymentStatus, current.carrierPaymentStatus),
    );
    if (carrierPaymentStatus) {
        derived.carrierPaymentStatus = carrierPaymentStatus;
    }

    const shipperPaymentStatus = derivePaymentStatus(
        status,
        pick(patch.shipperPaymentStatus, current.shipperPaymentStatus),
    );
    if (shipperPaymentStatus) {
        derived.shipperPaymentStatus = shipperPaymentStatus;
    }

    // Booked scaffolding: the moment a payment becomes "pending" the whole
    // total is outstanding — remaining = total, remaining % = 100, paid = 0.
    // Real paid amounts (status partially / completed) are derived below and
    // win over this scaffold; POP-governed legs are then overridden by
    // proofPaymentPatch in the caller.
    const carrierEffectiveTotal = adjustedTotal(
        pick(patch.carrierTotal, toNumber(current.carrierTotal)),
        current.carrierDebitTotal,
        current.carrierCreditTotal,
    );
    const shipperEffectiveTotal = adjustedTotal(
        pick(patch.shipperTotal, toNumber(current.shipperTotal)),
        current.shipperDebitTotal,
        current.shipperCreditTotal,
    );

    if (carrierPaymentStatus === "pending" && carrierEffectiveTotal !== null) {
        derived.carrierRemainingAmount = decimal(carrierEffectiveTotal);
        derived.carrierRemainingPercentage = "100";
        derived.carrierPaidPercentage = "0";
    }
    if (shipperPaymentStatus === "pending" && shipperEffectiveTotal !== null) {
        derived.shipperRemainingAmount = decimal(shipperEffectiveTotal);
        derived.shipperRemainingPercentage = "100";
        derived.shipperReceivedPercentage = "0";
    }

    const carrier = derivePayment(
        pick(patch.carrierPaidAmount, toNumber(current.carrierPaidAmount)),
        carrierEffectiveTotal,
        pick<string>(patch.carrierPaymentStatus, current.carrierPaymentStatus),
    );
    if (carrier) {
        derived.carrierPaidPercentage = carrier.paidPercentage;
        derived.carrierRemainingAmount = carrier.remainingAmount;
        derived.carrierRemainingPercentage = carrier.remainingPercentage;
    }

    const shipper = derivePayment(
        pick(patch.shipperReceivedAmount, toNumber(current.shipperReceivedAmount)),
        shipperEffectiveTotal,
        pick<string>(patch.shipperPaymentStatus, current.shipperPaymentStatus),
    );
    if (shipper) {
        derived.shipperReceivedPercentage = shipper.paidPercentage;
        derived.shipperRemainingAmount = shipper.remainingAmount;
        derived.shipperRemainingPercentage = shipper.remainingPercentage;
    }

    /**
     * Money chain. VAT and subtotal always follow the VAT-inclusive total,
     * so a regime/route change keeps the agreed total and re-splits it.
     * Recomputed only when the patch touches one of the chain's inputs —
     * untouched (possibly hand-entered historical) amounts stay as stored
     */
    const route = patch.route ?? current.route;
    const fiscalRegime = pick(patch.fiscalRegime, current.fiscalRegime);
    const shipperTotal = pick(patch.shipperTotal, toNumber(current.shipperTotal));
    const carrierTotal = pick(patch.carrierTotal, toNumber(current.carrierTotal));

    const touchesShipperAmounts =
        patch.route !== undefined || patch.shipperTotal !== undefined ||
        patch.shipperSubtotal !== undefined || patch.shipperVAT !== undefined;
    const touchesCarrierAmounts =
        patch.fiscalRegime !== undefined || patch.carrierTotal !== undefined ||
        patch.carrierSubtotal !== undefined || patch.carrierVAT !== undefined;

    let shipperVAT = pick(patch.shipperVAT, toNumber(current.shipperVAT));

    if (touchesShipperAmounts && shipperTotal !== null) {
        shipperVAT = round2(route === "national" ? shipperTotal * VAT_RATE : 0);
        derived.shipperVAT = decimal(shipperVAT);
        derived.shipperSubtotal = decimal(round2(shipperTotal - shipperVAT));
    }

    if (touchesCarrierAmounts && carrierTotal !== null) {
        const carrierVAT = round2(fiscalRegime === "normal" ? carrierTotal * VAT_RATE : 0);
        derived.carrierVAT = decimal(carrierVAT);
        derived.carrierSubtotal = decimal(round2(carrierTotal - carrierVAT));
    }

    // Same commission rules as the create schema's transform: a missing
    // regime falls to the else branch (commissionVAT = shipperVAT)
    if ((touchesShipperAmounts || touchesCarrierAmounts) && shipperTotal !== null && carrierTotal !== null) {
        const commissionTotal = round2(shipperTotal - carrierTotal);
        const commissionVAT =
            fiscalRegime === "n/a" ? 0
                : fiscalRegime === "normal" ? round2(commissionTotal * VAT_RATE)
                    : (shipperVAT ?? 0);

        derived.apploadCommissionTotal = decimal(commissionTotal);
        derived.apploadCommissionVAT = decimal(commissionVAT);
        derived.apploadCommissionSubtotal = decimal(round2(commissionTotal - commissionVAT));
    }

    return derived;
}
