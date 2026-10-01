import { z } from "zod";

import { CURRENCY, FISCAL_REGIME, PriceModelSchema } from "@workspace/db/types";

/**
 * What the rentals doors accept. A rental is a contract on the days basis
 * (see schemas/contract.ts); these are its own shapes: lines per truck, the
 * daily log, the payments.
 */

const NAME_MAX = 120;
const REFERENCE_MAX = 60;
const NOTES_MAX = 2000;

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const location = z.object({
    address: z.string().nonempty(),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

/** Only a per-day price fits a rental; the domain checks it again. */
const perDay = PriceModelSchema.refine((model) => model.model === "per-day", { message: "PRICE_MODEL_BASIS_MISMATCH" });

export const RentalLineInputSchema = z.object({
    /** A truck from the fleet (with its driver), or a typed plate for a provider off the portal */
    truckId: z.string().nonempty().nullable().optional(),
    truckPlate: text(REFERENCE_MAX).nullable().optional(),
    driverId: z.string().nonempty().nullable().optional(),
    /** A connected transporter, or a typed name; null with no name is the owner's own fleet */
    carrierOrgId: z.string().nonempty().nullable().optional(),
    carrierName: text(NAME_MAX).nullable().optional(),
    /** What the owner pays the provider per day; null on its own fleet */
    buyPrice: perDay.nullable().optional(),
    notes: text(NOTES_MAX).nullable().optional(),
});

export type RentalLineInput = z.infer<typeof RentalLineInputSchema>;

export const RentalInputSchema = z.object({
    clientOrgId: z.string().nonempty().nullable().optional(),
    clientName: text(NAME_MAX).nullable().optional(),
    clientReference: text(REFERENCE_MAX).nullable().optional(),
    /** Where the trucks work; a rental has no lane */
    site: location.nullable().optional(),
    startsOn: isoDate,
    /** Null is an open period */
    endsOn: isoDate.nullable(),
    currency: z.enum(CURRENCY),
    fiscalRegime: z.enum(FISCAL_REGIME).nullable().optional(),
    /** What the client pays per day; null when there is no client half */
    sellPrice: perDay.nullable().optional(),
    notes: text(NOTES_MAX).nullable().optional(),
});

export type RentalInput = z.infer<typeof RentalInputSchema>;

export const CreateRentalSchema = RentalInputSchema.extend({ lines: z.array(RentalLineInputSchema).min(1).max(50) });

const versioned = {
    id: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
};

export const UpdateRentalSchema = RentalInputSchema.extend(versioned);

export const AddLineSchema = RentalLineInputSchema.extend({ contractId: z.string().nonempty() });
export const EndLineSchema = z.object({ id: z.string().nonempty(), endsOn: isoDate });

export const RENTAL_DAY_STATE = ["worked", "standby", "stopped", "off"] as const;

export const MarkDaySchema = z.object({
    allocationId: z.string().nonempty(),
    day: isoDate,
    state: z.enum(RENTAL_DAY_STATE),
    note: text(300).nullable().optional(),
});

export const DisputeDaySchema = z.object({
    allocationId: z.string().nonempty(),
    day: isoDate,
    note: text(300).nullable().optional(),
});

export const SettleDisputeSchema = z.object({
    allocationId: z.string().nonempty(),
    day: isoDate,
    resolution: z.enum(["accept", "withdraw"]),
    state: z.enum(RENTAL_DAY_STATE).optional(),
});

export const RecordRentalPaymentSchema = z.object({
    contractId: z.string().nonempty(),
    allocationId: z.string().nonempty().nullable().optional(),
    leg: z.enum(["sell", "buy"]),
    amount: z.number().finite().refine((value) => value !== 0 && Math.abs(value) <= 1e12),
    currency: z.enum(CURRENCY),
    paidAt: z.date(),
    reference: text(REFERENCE_MAX).nullable().optional(),
});
