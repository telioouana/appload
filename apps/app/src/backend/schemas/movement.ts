import { z } from "zod";

import type {
    MovementCostKind,
    MovementDocumentLeg,
    MovementDocumentType,
    MovementExecution,
    MovementStatus,
} from "@workspace/db/movements";
import { CATEGORIES, CURRENCY, FISCAL_REGIME, ROUTE_TYPE, WEIGHT_UNIT } from "@workspace/db/types";
import { toE164 } from "@workspace/ui/lib/phone";

/**
 * What the portal's own loads accept on the way in.
 *
 * The vocabularies are restated rather than imported from
 * `@workspace/db/movements`: that module builds drizzle tables at import time,
 * and the form schemas built on these ship in the browser bundle. The
 * `satisfies` clauses pin each list to the column's own union, so a change to
 * the database vocabulary fails the typecheck here.
 *
 * These are the message-free variants the procedures validate with; the
 * forms build translated ones from the same shapes in the movements rebuild.
 */

export const MOVEMENT_EXECUTION = ["own-fleet", "partner"] as const satisfies readonly MovementExecution[];

export const MOVEMENT_STATUS = [
    "procurement",
    "offered",
    "declined",
    "scheduled",
    "booked",
    "in-transit",
    "delivered",
    "closed",
    "cancelled",
] as const satisfies readonly MovementStatus[];

/** Where a new load may start: a load is never created offered, declined or finished. */
export const CREATE_STATUS = ["procurement", "scheduled", "booked", "in-transit"] as const satisfies readonly MovementStatus[];

export const MOVEMENT_COST_KIND = [
    "fuel",
    "tolls",
    "driver-allowance",
    "border-fees",
    "escort",
    "parking",
    "maintenance",
    "fine",
    "loading",
    "offloading",
    "insurance",
    "other",
] as const satisfies readonly MovementCostKind[];

export const MOVEMENT_DOCUMENT_TYPE = [
    "pod",
    "cmr",
    "invoice",
    "receipt",
    "evidence",
    "loading-photo",
    "transport-order",
    "other",
] as const satisfies readonly MovementDocumentType[];

export const MOVEMENT_DOCUMENT_LEG = ["sell", "buy"] as const satisfies readonly MovementDocumentLeg[];

export const NAME_MAX = 120;
export const PLATE_MAX = 20;
export const TEXT_MAX = 500;
export const NOTES_MAX = 2000;
export const REFERENCE_MAX = 80;

// DecimalInput keeps amounts as strings while typing; the same coercion the
// offer schema uses, so an empty field reads as missing rather than zero
const toNumber = (value: unknown) => {
    if (value === "" || value === null || value === undefined) return undefined;

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
    }

    return value;
};

const amount = z.preprocess(toNumber, z.number().nonnegative().max(1e12));
const positiveAmount = z.preprocess(toNumber, z.number().positive().max(1e12));

const location = z.object({
    address: z.string().nonempty(),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

const text = (max: number) => z.string().trim().max(max);

/**
 * One leg of the deal. VAT-inclusive total, like every money block in the
 * repo; the subtotal and VAT are the form's derivation and only validated.
 */
export const MoneyLegSchema = z.object({
    subtotal: amount.optional(),
    vat: amount.optional(),
    total: positiveAmount,
    currency: z.enum(CURRENCY),
    fiscalRegime: z.enum(FISCAL_REGIME).optional(),
});

export type MoneyLegInput = z.infer<typeof MoneyLegSchema>;

/** Each side's own invoice for a leg — editable by its owner whatever else is frozen. */
export const InvoiceSchema = z.object({
    invoiceNumber: text(REFERENCE_MAX).optional(),
    invoiceDate: z.date().optional(),
});

/** The rig: free text for whoever is off the platform, fleet ids for the owner's own. */
const rig = {
    driverName: text(NAME_MAX).optional(),
    driverPhone: z.e164().optional(),
    driverId: z.string().nonempty().optional(),
    truckPlate: text(PLATE_MAX).optional(),
    truckId: z.string().nonempty().optional(),
    trailerId: z.string().nonempty().optional(),
    linkId: z.string().nonempty().optional(),
};

const details = {
    origin: location,
    destination: location,
    route: z.enum(ROUTE_TYPE).default("national"),
    cargoDescription: text(TEXT_MAX).optional(),
    category: z.enum(CATEGORIES).optional(),
    weight: amount.optional(),
    weightUnit: z.enum(WEIGHT_UNIT).optional(),
    expectedLoadingDate: z.date().optional(),
    expectedDeliveryAt: z.date().optional(),
};

const client = {
    /** A connected company; the server checks the connection */
    clientOrgId: z.string().nonempty().optional(),
    /** A client that is not on the portal at all */
    clientName: text(NAME_MAX).optional(),
    clientReference: text(REFERENCE_MAX).optional(),
};

const carrier = {
    /** A connected transporter; the server checks both */
    carrierOrgId: z.string().nonempty().optional(),
    /** A transporter that is not on the portal at all */
    carrierName: text(NAME_MAX).optional(),
};

export const CreateMovementBaseSchema = z.object({
    execution: z.enum(MOVEMENT_EXECUTION),
    status: z.enum(CREATE_STATUS).default("procurement"),
    ...details,
    ...client,
    ...carrier,
    ...rig,
    sell: MoneyLegSchema.optional(),
    buy: MoneyLegSchema.optional(),
    notes: text(NOTES_MAX).optional(),
});

export type CreateMovementInput = z.infer<typeof CreateMovementBaseSchema>;

/**
 * A patch. Every block is optional; which blocks may be written depends on
 * where the load is and who else has agreed to it (policy.ts), and the
 * procedure refuses a block it may not write rather than dropping it.
 * `null` clears an optional field; `undefined` leaves it alone.
 */
export const UpdateMovementBaseSchema = z.object({
    id: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
    origin: location.optional(),
    destination: location.optional(),
    route: z.enum(ROUTE_TYPE).optional(),
    cargoDescription: text(TEXT_MAX).nullable().optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
    weight: amount.nullable().optional(),
    weightUnit: z.enum(WEIGHT_UNIT).nullable().optional(),
    expectedLoadingDate: z.date().nullable().optional(),
    expectedDeliveryAt: z.date().nullable().optional(),
    clientOrgId: z.string().nonempty().nullable().optional(),
    clientName: text(NAME_MAX).nullable().optional(),
    clientReference: text(REFERENCE_MAX).nullable().optional(),
    carrierOrgId: z.string().nonempty().nullable().optional(),
    carrierName: text(NAME_MAX).nullable().optional(),
    driverName: text(NAME_MAX).nullable().optional(),
    driverPhone: z.e164().nullable().optional(),
    driverId: z.string().nonempty().nullable().optional(),
    truckPlate: text(PLATE_MAX).nullable().optional(),
    truckId: z.string().nonempty().nullable().optional(),
    trailerId: z.string().nonempty().nullable().optional(),
    linkId: z.string().nonempty().nullable().optional(),
    sell: MoneyLegSchema.nullable().optional(),
    buy: MoneyLegSchema.nullable().optional(),
    sellInvoice: InvoiceSchema.optional(),
    buyInvoice: InvoiceSchema.optional(),
    notes: text(NOTES_MAX).nullable().optional(),
});

export type UpdateMovementInput = z.infer<typeof UpdateMovementBaseSchema>;

const versioned = {
    id: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
};

export const TransitionMovementBaseSchema = z.object({
    ...versioned,
    to: z.enum(MOVEMENT_STATUS),
    note: text(TEXT_MAX).optional(),
});

export const OfferMovementBaseSchema = z.object({
    ...versioned,
    message: text(TEXT_MAX).optional(),
});

export const WithdrawOfferBaseSchema = z.object(versioned);

export const RespondOfferBaseSchema = z.object({
    ...versioned,
    decision: z.enum(["accept", "decline"]),
    note: text(TEXT_MAX).optional(),
});

export const ConvertMovementBaseSchema = z.object({
    ...versioned,
    to: z.enum(MOVEMENT_EXECUTION),
    carrierOrgId: z.string().nonempty().optional(),
    carrierName: text(NAME_MAX).optional(),
});

export const AddCostBaseSchema = z.object({
    movementId: z.string().nonempty(),
    kind: z.enum(MOVEMENT_COST_KIND),
    description: text(TEXT_MAX).optional(),
    amount: positiveAmount,
    currency: z.enum(CURRENCY),
    incurredAt: z.date().optional(),
    rechargeable: z.boolean().default(false),
});

export const AddMovementDocumentBaseSchema = z.object({
    movementId: z.string().nonempty(),
    type: z.enum(MOVEMENT_DOCUMENT_TYPE),
    leg: z.enum(MOVEMENT_DOCUMENT_LEG).optional(),
    url: z.url(),
    title: text(200).optional(),
    size: z.number().int().positive().optional(),
    mimeType: text(100).optional(),
    costId: z.string().nonempty().optional(),
});

/** Validating one loading photo. The document says which load it is on. */
export const ApproveMovementDocumentBaseSchema = z.object({
    id: z.string().nonempty(),
});

/**
 * Emailing the partner the confirmation of a load. The browser fills the
 * template and uploads the result, so what reaches the server is the
 * EdgeStore URL it came back with plus who it goes to.
 */
export const SendConfirmationBaseSchema = z.object({
    id: z.string().nonempty(),
    url: z.url(),
    filename: text(200).min(1),
    to: z.email(),
    cc: z.array(z.email()).max(5).default([]),
    message: text(TEXT_MAX).optional(),
});

export const RecordPaymentBaseSchema = z.object({
    ...versioned,
    leg: z.enum(MOVEMENT_DOCUMENT_LEG),
    /** What moved against the leg in this one payment; negative corrects an earlier one */
    amount: z.preprocess(toNumber, z.number().refine((value) => value !== 0).refine((value) => Math.abs(value) <= 1e12)),
    paidAt: z.date().optional(),
    reference: text(REFERENCE_MAX).optional(),
});

// ---------------------------------------------------------------------------
// The forms. What the browser holds while a person types: amounts as the
// strings DecimalInput keeps, a phone as a country and a national number,
// every picker as a string with a sentinel for "none" and for "somebody not
// on the portal". The sheet and the dialogs turn these into the inputs
// above; the procedures validate those again.
// ---------------------------------------------------------------------------

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.loads.form.errors`). */
export type LoadMessageField =
    | "address"
    | "amount"
    | "weight"
    | "phone"
    | "name"
    | "reference"
    | "text";

type Message = (field: LoadMessageField) => ErrorParam;

/** Picker sentinels: nobody picked, and somebody typed in instead of picked. */
export const NONE = "__none";
export const TYPED = "__typed";

const formLocation = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(error),
    country: z.string().nonempty(error),
    state: z.string().nonempty(error),
});

/** An amount as typed: empty, or a number that is not negative. */
const typedAmount = (error?: ErrorParam) => z.string().refine(
    (value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12),
    error,
);

export function LoadFormSchema(msg: Message) {
    return z
        .object({
            execution: z.enum(MOVEMENT_EXECUTION),
            status: z.enum(CREATE_STATUS),
            origin: formLocation(msg("address")),
            destination: formLocation(msg("address")),
            expectedLoadingDate: z.date().optional(),
            expectedDeliveryAt: z.date().optional(),
            cargoDescription: text(TEXT_MAX),
            category: z.enum(CATEGORIES).optional(),
            weight: typedAmount(msg("weight")),
            weightUnit: z.enum(WEIGHT_UNIT),
            clientOrgId: z.string(),
            clientName: text(NAME_MAX),
            clientReference: text(REFERENCE_MAX),
            carrierOrgId: z.string(),
            carrierName: text(NAME_MAX),
            driverId: z.string(),
            driverName: text(NAME_MAX),
            country: z.string(),
            phoneNumber: z.string(),
            truckId: z.string(),
            truckPlate: text(PLATE_MAX),
            sellTotal: typedAmount(msg("amount")),
            sellCurrency: z.enum(CURRENCY),
            sellFiscalRegime: z.enum(FISCAL_REGIME).optional(),
            sellInvoiceNumber: text(REFERENCE_MAX),
            buyTotal: typedAmount(msg("amount")),
            buyCurrency: z.enum(CURRENCY),
            buyFiscalRegime: z.enum(FISCAL_REGIME).optional(),
            buyInvoiceNumber: text(REFERENCE_MAX),
            notes: text(NOTES_MAX),
        })
        // A typed client or partner needs its name
        .refine((data) => data.clientOrgId !== TYPED || data.clientName.trim().length > 0, {
            ...(msg("name") ?? {}),
            path: ["clientName"],
        })
        .refine((data) => data.execution !== "partner" || data.carrierOrgId !== TYPED || data.carrierName.trim().length > 0, {
            ...(msg("name") ?? {}),
            path: ["carrierName"],
        })
        // A number typed in has to be a whole one; an untouched field is fine
        .refine((data) => data.phoneNumber.trim() === "" || z.e164().safeParse(toE164(data.country, data.phoneNumber)).success, {
            ...(msg("phone") ?? {}),
            path: ["phoneNumber"],
        });
}

export type LoadForm = z.infer<ReturnType<typeof LoadFormSchema>>;

export type PaymentMessageField = "amount" | "reference";

export function PaymentFormSchema(msg: (field: PaymentMessageField) => ErrorParam) {
    return z
        .object({
            leg: z.enum(MOVEMENT_DOCUMENT_LEG),
            amount: z.string().refine((value) => Number(value) > 0 && Number(value) <= 1e12, msg("amount")),
            paidAt: z.date().optional(),
            reference: text(REFERENCE_MAX),
            /** Takes an earlier payment back rather than adding one */
            correction: z.boolean(),
        })
        // A correction is a line of its own on the books, and says why
        .refine((data) => !data.correction || data.reference.trim().length > 0, {
            ...(msg("reference") ?? {}),
            path: ["reference"],
        });
}

export type PaymentForm = z.infer<ReturnType<typeof PaymentFormSchema>>;

export type CostMessageField = "amount" | "text";

export function CostFormSchema(msg: (field: CostMessageField) => ErrorParam) {
    return z.object({
        kind: z.enum(MOVEMENT_COST_KIND),
        description: text(TEXT_MAX),
        amount: z.string().refine((value) => Number(value) > 0 && Number(value) <= 1e12, msg("amount")),
        currency: z.enum(CURRENCY),
        incurredAt: z.date().optional(),
        rechargeable: z.boolean(),
    });
}

export type CostForm = z.infer<ReturnType<typeof CostFormSchema>>;
