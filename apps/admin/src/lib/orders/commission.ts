import { FISCAL_REGIME } from "@workspace/db/types";

/**
 * Appload's margin on one order: what the shipper pays minus what the
 * carrier gets, split into VAT and subtotal by the carrier's fiscal
 * regime: a carrier on the normal regime already charged VAT on its own
 * price, so only the commission carries it; a carrier on a simplified
 * regime (3% or 5%) charged none, so the VAT on the whole client price
 * (carrier total + commission) sits on Appload's side — that is the shipper
 * leg's own VAT, which a regional route sets to zero; "n/a" carries none.
 * One rule, every writer — offer pricing (priceOffer), the update
 * derivation (./derive) and the acceptance of a carrier offer — so a booked
 * order's commission cannot depend on which door booked it.
 */

export type FiscalRegime = (typeof FISCAL_REGIME)[number];

// Mozambican VAT extracted from a VAT-inclusive total: total * (0.16/1.16)
export const VAT_RATE = 0.16 / 1.16;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeCommission(input: {
    shipperTotal: number;
    /** The VAT inside @shipperTotal: route-split, so zero on a regional trip */
    shipperVAT: number;
    carrierTotal: number;
    fiscalRegime: FiscalRegime | null | undefined;
}): { commissionTotal: number; commissionVAT: number; commissionSubtotal: number } {
    const commissionTotal = round2(input.shipperTotal - input.carrierTotal);

    // A missing regime (possible on a row written before the column
    // existed) falls to the simplified branch, as it always has
    const commissionVAT =
        input.fiscalRegime === "n/a" ? 0
            : input.fiscalRegime === "normal" ? round2(commissionTotal * VAT_RATE)
                : round2(input.shipperVAT);

    return {
        commissionTotal,
        commissionVAT,
        commissionSubtotal: round2(commissionTotal - commissionVAT),
    };
}

export type RouteKind = "national" | "regional";

/**
 * Prices one carrier offer the way the client will see it. The quoted
 * carrier total plus Appload's commission is the client's total, VAT-split
 * by the route (national trips carry VAT, regional ones do not — the rule
 * the deal form always used for the shipper leg), and the commission is
 * split by the carrier's regime through computeCommission. An accepted
 * offer therefore writes the same three legs onto the order that the old
 * deal form did, from one typed commission.
 */
export function priceOffer(input: {
    carrierTotal: number;
    fiscalRegime: FiscalRegime | null | undefined;
    commissionTotal: number;
    route: RouteKind;
}): {
    commissionTotal: number;
    commissionVAT: number;
    commissionSubtotal: number;
    clientTotal: number;
    clientVAT: number;
    clientSubtotal: number;
} {
    const clientTotal = round2(input.carrierTotal + input.commissionTotal);
    const clientVAT = input.route === "national" ? round2(clientTotal * VAT_RATE) : 0;
    const clientSubtotal = round2(clientTotal - clientVAT);

    const commission = computeCommission({
        shipperTotal: clientTotal,
        shipperVAT: clientVAT,
        carrierTotal: input.carrierTotal,
        fiscalRegime: input.fiscalRegime,
    });

    return { ...commission, clientTotal, clientVAT, clientSubtotal };
}

/** The pricing an offer row stores, as its numeric columns expect it. */
export function offerPricingColumns(pricing: ReturnType<typeof priceOffer>) {
    const decimal = (value: number) => value.toFixed(2);

    return {
        commissionSubtotal: decimal(pricing.commissionSubtotal),
        commissionVAT: decimal(pricing.commissionVAT),
        commissionTotal: decimal(pricing.commissionTotal),
        clientSubtotal: decimal(pricing.clientSubtotal),
        clientVAT: decimal(pricing.clientVAT),
        clientTotal: decimal(pricing.clientTotal),
    };
}
