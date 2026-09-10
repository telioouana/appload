import { z } from "zod";

import {
    CATEGORIES,
    CURRENCY,
    FISCAL_REGIME,
    LOAD_TYPE,
    LOADING_BAY,
    PACKING,
    ROUTE_TYPE,
    WEIGHT_UNIT,
} from "@workspace/db/types";

/**
 * The two forms of a standing quote: what a carrier offers (`create`) and
 * what a client fills in to turn one into an order (`accept`).
 *
 * Same recipe as the other portal forms — one builder, a message-free Base
 * variant the procedure validates with, and a factory the form calls with
 * its translated copy.
 */

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.quotes`). */
export type QuoteMessageField =
    | "address"
    | "category"
    | "client"
    | "count"
    | "currency"
    | "date"
    | "description"
    | "distance"
    | "list"
    | "note"
    | "total"
    | "value"
    | "weight";

type Message = (field: QuoteMessageField) => ErrorParam;

// DecimalInput keeps amounts as strings while typing ("12.5"); convert to
// numbers before validation and treat empty strings as missing. Mirrors
// src/backend/schemas/order.ts, whose payload this one is folded into.
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
const freeAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).optional());
const requiredCount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).int(error).positive(error));

/** The shape stored in the jsonb lane columns (see `Location` in @workspace/db). */
const location = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(error),
    country: z.string().nonempty(error),
    state: z.string().nonempty(error),
});

export const QUOTE_NOTES_MAX = 1000;
export const QUOTE_DECISION_NOTE_MAX = 1000;

/**
 * What a carrier offers a connected client: a lane, a price and how long the
 * price holds. The client it goes to is checked again server-side against the
 * tenant's own accepted `client-carrier` connections — an id typed into the
 * request is never trusted.
 *
 * The price is the VAT-inclusive @total; @subtotal and @vat are derived from
 * it by the form (regime "normal" → total * (0.16/1.16), otherwise 0) exactly
 * as an order offer's leg is, and only validated here. Appload's commission
 * is not a field: a portal quote carries none until staff price it in Admin.
 */
export function buildQuote(msg: Message) {
    return z
        .object({
            clientOrgId: z.string().nonempty(msg("client")),

            origin: location(msg("address")),
            destination: location(msg("address")),
            loadingDate: z.date(msg("date")).optional(),
            route: z.enum(ROUTE_TYPE, msg("list")),

            /** What the offered truck carries, when the carrier wants to say */
            loadingBay: z.enum(LOADING_BAY, msg("list")).optional(),
            capacityWeight: optionalAmount(msg("weight")),
            capacityUnit: z.enum(WEIGHT_UNIT, msg("list")).optional(),

            fiscalRegime: z.enum(FISCAL_REGIME, msg("list")),
            subtotal: optionalAmount(msg("value")),
            vat: optionalAmount(msg("value")),
            total: requiredAmount(msg("total")),
            currency: z.enum(CURRENCY, msg("currency")),

            includesGit: z.boolean().default(false),
            includesGps: z.boolean().default(false),

            notes: z.string().trim().max(QUOTE_NOTES_MAX).optional(),
            validUntil: z.date(msg("date")).optional(),
        })
        // A capacity without its unit is a number nobody can read
        .refine(
            (data) => data.capacityWeight === undefined || data.capacityUnit !== undefined,
            { ...(msg("list") ?? {}), path: ["capacityUnit"] },
        );
}

// Message-free variant, used by `quotes.create` to validate input
export const CreateQuoteBaseSchema = buildQuote(() => undefined);

/** Parsed values (amounts are numbers, defaults applied). */
export type CreateQuoteForm = z.infer<typeof CreateQuoteBaseSchema>;

/** Raw field values while editing (amount fields hold strings). */
export type CreateQuoteFormInput = z.input<typeof CreateQuoteBaseSchema>;

/** Client-side variant with translated error messages. */
export function CreateQuoteSchema(msg: Message) {
    return buildQuote(msg);
}

/**
 * The cargo the client adds when it accepts a quote. The lane, the price and
 * the carrier all come from the quote itself, so this is only what an order
 * needs and a quote never carried.
 *
 * @expectedLoadingDate is optional here and falls back to the quote's own
 * loading date server-side; a quote with neither is refused rather than
 * booked for an unknown day.
 *
 * @distance is computed in the browser by the Google distance helper
 * (`@workspace/ui/lib/google` → `distanceCalculator`) and sent with the
 * payload: the portal has no Routes credentials of its own.
 */
export function buildAcceptQuote(msg: Message) {
    return z.object({
        id: z.string().nonempty(),
        cargo: z.object({
            category: z.enum(CATEGORIES, msg("category")),
            description: z.string().trim().nonempty(msg("description")).max(2000),
            weight: requiredAmount(msg("weight")),
            weightUnit: z.enum(WEIGHT_UNIT, msg("list")),
            loadType: z.enum(LOAD_TYPE, msg("list")),
            packing: z.enum(PACKING, msg("list")).optional(),

            expectedLoadingDate: z.date(msg("date")).optional(),
            expectedOffloadingDate: z.date(msg("date")).optional(),

            distance: requiredAmount(msg("distance")),
            deliveries: requiredCount(msg("count")).default(1),
            expectedTrucks: requiredCount(msg("count")).default(1),

            isHazardous: z.boolean().default(false),
            hazchemCode: z.string().trim().max(40).optional(),
            isRefrigerated: z.boolean().default(false),
            // Refrigerated cargo temperatures can be negative
            temperature: freeAmount(msg("value")),
            temperatureInstructions: z.string().trim().max(1000).optional(),
        }),
    });
}

// Message-free variant, used by `quotes.accept` to validate input
export const AcceptQuoteBaseSchema = buildAcceptQuote(() => undefined);

export type AcceptQuoteForm = z.infer<typeof AcceptQuoteBaseSchema>;
export type AcceptQuoteFormInput = z.input<typeof AcceptQuoteBaseSchema>;

/** Client-side variant with translated error messages. */
export function AcceptQuoteSchema(msg: Message) {
    return buildAcceptQuote(msg);
}

/** The cargo block on its own — what the accept dialog's form owns. */
export type AcceptQuoteCargo = AcceptQuoteForm["cargo"];
export type AcceptQuoteCargoInput = AcceptQuoteFormInput["cargo"];

/** Taking back a quote nobody answered; the client is told, quietly. */
export const WithdrawQuoteBaseSchema = z.object({ id: z.string().nonempty() });

export type WithdrawQuoteForm = z.infer<typeof WithdrawQuoteBaseSchema>;

/** Turning one down, with the reason the carrier reads. */
export function buildDeclineQuote(msg: Message) {
    return z.object({
        id: z.string().nonempty(),
        note: z.string().trim().max(QUOTE_DECISION_NOTE_MAX, msg("note")).optional(),
    });
}

export const DeclineQuoteBaseSchema = buildDeclineQuote(() => undefined);

export type DeclineQuoteForm = z.infer<typeof DeclineQuoteBaseSchema>;

/** Client-side variant with translated error messages. */
export function DeclineQuoteSchema(msg: Message) {
    return buildDeclineQuote(msg);
}
