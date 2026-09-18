import { z } from "zod";

import { CURRENCY, FISCAL_REGIME } from "@workspace/db/types";

/**
 * What a carrier quotes for an order it was asked about.
 *
 * The shared offer vocabulary (`@workspace/domain/orders/offer-schemas`)
 * carries three fields a tenant never types: the carrier identity (it is the
 * session's own organization) and `commissionTotal` (Appload's cut is
 * Appload's to set — the portal always sends 0, and staff price the deal in
 * Admin). This is the same money block minus those, so the procedure can
 * hand the domain pricing helper exactly what it expects.
 */

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.orders`). */
export type OfferMessageField =
    | "currency"
    | "list"
    | "subtotal"
    | "total"
    | "value";

type Message = (field: OfferMessageField) => ErrorParam;

// DecimalInput keeps amounts as strings while typing ("12.5"); convert to
// numbers before validation and treat empty strings as missing
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

const requiredAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).positive(error));
const optionalAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).nonnegative(error).optional());

export const OFFER_NOTES_MAX = 1000;

export function buildOfferValues(msg: Message) {
    return z.object({
        fiscalRegime: z.enum(FISCAL_REGIME, msg("list")),
        /**
         * VAT-inclusive price the carrier is asking. @vat and @subtotal are
         * derived from it by the form (regime "normal" → total * (0.16/1.16),
         * otherwise 0) and only validated here, exactly as Admin's offer
         * dialog does it.
         */
        subtotal: optionalAmount(msg("subtotal")),
        vat: optionalAmount(msg("value")),
        total: requiredAmount(msg("total")),
        currency: z.enum(CURRENCY, msg("currency")),
        includesGit: z.boolean().default(false),
        includesGps: z.boolean().default(false),
        notes: z.string().trim().max(OFFER_NOTES_MAX).optional(),
    });
}

// Message-free variant, used by `orders.offers.create` to validate input
export const OfferValuesBaseSchema = buildOfferValues(() => undefined);

/** The same block as a patch: `orders.offers.update` only writes what it is sent. */
export const OfferPatchBaseSchema = OfferValuesBaseSchema.partial();

/** Parsed values (amounts are numbers, defaults applied). */
export type OfferValuesForm = z.infer<typeof OfferValuesBaseSchema>;

/** Raw field values while editing (amount fields hold strings). */
export type OfferValuesFormInput = z.input<typeof OfferValuesBaseSchema>;

export type OfferPatchForm = z.infer<typeof OfferPatchBaseSchema>;

/**
 * Client-side variant with translated error messages. The form passes a
 * builder rather than the translator itself so the message keys live in the
 * view that owns them:
 *
 *     OfferValuesSchema((field) => ({ error: t(`offer.errors.${field}`) }))
 */
export function OfferValuesSchema(msg: Message) {
    return buildOfferValues(msg);
}

/** Booking: the shipper accepts one offer, under the order's optimistic lock. */
export const AcceptOfferBaseSchema = z.object({
    orderId: z.string().nonempty(),
    offerId: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
});

export type AcceptOfferForm = z.infer<typeof AcceptOfferBaseSchema>;

export const OFFER_DECISION_NOTE_MAX = 1000;

/** Saying no to one offer; the order itself does not move. */
export const DeclineOfferBaseSchema = z.object({
    offerId: z.string().nonempty(),
    note: z.string().trim().max(OFFER_DECISION_NOTE_MAX).optional(),
});

export type DeclineOfferForm = z.infer<typeof DeclineOfferBaseSchema>;
