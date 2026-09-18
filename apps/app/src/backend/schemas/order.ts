import { z } from "zod";

import { CATEGORIES, CURRENCY, LOAD_TYPE, PACKING, ROUTE_TYPE, TRIP_TYPE, WEIGHT_UNIT } from "@workspace/db/types";

/**
 * What a client fills in to file an order from the portal.
 *
 * The shared create door (`@workspace/domain/orders/create`) takes the full
 * Admin payload — shipper identity, status, carrier offers, commission, the
 * booking block. None of that is the tenant's to type: the server fills the
 * shipper from the session, the status is always "prospect", the offer list
 * is always empty and the commission is always zero. So this is a strict
 * SUBSET, and `orders.create` is what folds it into the domain shape.
 *
 * Same recipe as the other portal forms: one builder, a message-free Base
 * variant the procedure validates with, and a factory the form calls with
 * its translated copy.
 */

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.orders`). */
export type OrderMessageField =
    | "address"
    | "category"
    | "count"
    | "currency"
    | "date"
    | "description"
    | "distance"
    | "list"
    | "value"
    | "weight";

type Message = (field: OrderMessageField) => ErrorParam;

// DecimalInput keeps amounts as strings while typing ("12.5"); convert to
// numbers before validation and treat empty strings as missing. Mirrors the
// domain's own create schema, which this payload is folded into.
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
const optionalAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).optional());
const requiredCount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).int(error).positive(error));

/** The shape stored in the jsonb address columns (see `Location` in @workspace/db). */
const location = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(error),
    country: z.string().nonempty(error),
    state: z.string().nonempty(error),
});

export function buildCreateOrder(msg: Message) {
    return z.object({
        loadingAddress: location(msg("address")),
        expectedLoadingDate: z.date(msg("date")),
        offloadingAddress: location(msg("address")),
        expectedOffloadingDate: z.date(msg("date")).optional(),

        /**
         * Road distance in kilometres, computed in the browser by the Google
         * distance helper the Admin new-order form uses
         * (`@workspace/ui/lib/google` → `distanceCalculator`) and sent with
         * the payload: the portal has no Routes credentials of its own.
         */
        distance: requiredAmount(msg("distance")),
        routeType: z.enum(ROUTE_TYPE, msg("list")),
        tripType: z.enum(TRIP_TYPE, msg("list")).default("normal"),

        category: z.enum(CATEGORIES, msg("category")),
        description: z.string().trim().nonempty(msg("description")).max(2000),
        weight: requiredAmount(msg("weight")),
        weightUnit: z.enum(WEIGHT_UNIT, msg("list")),
        loadType: z.enum(LOAD_TYPE, msg("list")),
        packing: z.enum(PACKING, msg("list")).optional(),

        deliveries: requiredCount(msg("count")).default(1),
        expectedTrucks: requiredCount(msg("count")).default(1),

        /** The leg the client will be invoiced in; the price itself comes from the offer it accepts */
        shipperCurrency: z.enum(CURRENCY, msg("currency")).default("MZN"),

        isHazardous: z.boolean().default(false),
        hazchemCode: z.string().trim().max(40).optional(),
        isRefrigerated: z.boolean().default(false),
        // Refrigerated cargo temperatures can be negative
        temperature: optionalAmount(msg("value")),
        temperatureInstructions: z.string().trim().max(1000).optional(),
    });
}

// Message-free variant, used by `orders.create` to validate input
export const CreateOrderBaseSchema = buildCreateOrder(() => undefined);

/** Parsed values (amounts are numbers, defaults applied). */
export type CreateOrderForm = z.infer<typeof CreateOrderBaseSchema>;

/** Raw field values while editing (amount fields hold strings). */
export type CreateOrderFormInput = z.input<typeof CreateOrderBaseSchema>;

/**
 * Client-side variant with translated error messages. The form passes a
 * builder rather than the translator itself so the message keys live in the
 * view that owns them:
 *
 *     CreateOrderSchema((field) => ({ error: t(`form.errors.${field}`) }))
 */
export function CreateOrderSchema(msg: Message) {
    return buildCreateOrder(msg);
}

/**
 * Who the order goes out to. The carriers are the tenant's own accepted
 * client-carrier connections, checked again server-side — an id typed into
 * the request is never trusted.
 */
export const REQUEST_MESSAGE_MAX = 500;
export const MAX_REQUEST_CARRIERS = 25;

export const SendRequestsBaseSchema = z.object({
    orderId: z.string().nonempty(),
    carrierOrgIds: z.array(z.string().nonempty()).min(1).max(MAX_REQUEST_CARRIERS),
    message: z.string().trim().max(REQUEST_MESSAGE_MAX).optional(),
});

export type SendRequestsForm = z.infer<typeof SendRequestsBaseSchema>;

/** Notes on a cancellation are the record of why the cargo went away. */
export const CANCEL_NOTE_MIN = 5;
export const CANCEL_NOTE_MAX = 2000;

export function buildCancelOrder(msg: Message) {
    return z.object({
        orderId: z.string().nonempty(),
        expectedVersion: z.number().int().min(1),
        note: z.string().trim().min(CANCEL_NOTE_MIN, msg("value")).max(CANCEL_NOTE_MAX, msg("value")),
    });
}

export const CancelOrderBaseSchema = buildCancelOrder(() => undefined);

export type CancelOrderForm = z.infer<typeof CancelOrderBaseSchema>;

/** Client-side variant with translated error messages. */
export function CancelOrderSchema(msg: Message) {
    return buildCancelOrder(msg);
}
