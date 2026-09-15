import { z } from "zod"

import { CURRENCY, FISCAL_REGIME } from "@workspace/db/types";

type ErrorParam = { error: string } | undefined;
type ErrorMessage = "carrier" | "currency" | "list" | "subtotal" | "total" | "value"

// DecimalInput keeps amounts as strings while typing ("12.5"); convert to
// numbers before validation and treat empty strings as missing. Copied from
// ./order rather than shared: each schema owns the ErrorMessage vocabulary
// its form translates
const toNumber = (value: unknown) => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
    }

    return value;
};

const requiredAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).nonnegative(error));
const optionalAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).nonnegative(error).optional());

/**
 * One carrier offer on an order: who would carry it, under which fiscal
 * regime, for how much, what Appload adds on top, and what the price
 * includes. The price is the
 * VAT-inclusive @total; @vat and @subtotal are derived from it by the form
 * (regime "normal" -> total * (0.16/1.16), otherwise 0) exactly as the
 * carrier leg used to be, and only validated here.
 *
 * Factory, like create() in ./order: the client passes translated messages,
 * the server passes () => undefined.
 */
export function offerValues(message: (field: ErrorMessage) => ErrorParam) {
    return z.object({
        carrierId: z.uuid(),
        carrierName: z.string().nonempty(message("carrier")),
        fiscalRegime: z.enum(FISCAL_REGIME, message("list")),

        subtotal: optionalAmount(message("subtotal")),
        vat: optionalAmount(message("value")),
        total: requiredAmount(message("total")),
        currency: z.enum(CURRENCY, message("currency")),
        // Appload's cut, VAT-inclusive, in the offer's currency. The client
        // price (@total + @commissionTotal) and both VAT splits are derived
        // by the server from it and the order's route (priceOffer)
        commissionTotal: requiredAmount(message("value")),

        includesGit: z.boolean().default(false),
        includesGps: z.boolean().default(false),
        notes: z.string().optional(),
    })
}

/**
 * An offer as the create/deal form carries it: @id when the row already
 * exists (the form only ever holds pending offers), @accepted when saving
 * the order as booked should book it. The create schema refines the
 * accepted-count rules — one offer may be accepted, and only when the
 * order itself is saved as booked.
 */
export function offerInput(message: (field: ErrorMessage) => ErrorParam) {
    return offerValues(message).extend({
        id: z.uuid().optional(),
        accepted: z.boolean().default(false),
    })
}

// Server side validation without message requirement
export const OfferValuesSchemaServer = offerValues(() => undefined)

/**
 * Declining or withdrawing an offer. Accepting is not here: it books the
 * order and therefore travels as order.transition's @offerId, never as an
 * offer mutation of its own.
 */
export const OfferDecisionSchema = z.object({
    offerId: z.string(),
    status: z.enum(["declined", "withdrawn"]),
    note: z.string().optional(),
})

// Parsed values after validation (amounts are numbers)
export type OfferValues = z.infer<typeof OfferValuesSchemaServer>

// Raw field values while editing (amount fields hold strings; defaults optional)
export type OfferValuesFormInput = z.input<typeof OfferValuesSchemaServer>
