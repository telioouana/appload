import { z } from "zod";

import type { MovementStatus } from "@workspace/db/movements";
import { toE164 } from "@workspace/ui/lib/phone";

/**
 * What a tenant fills in to watch a movement that is not an Appload order:
 * its own truck, or a load it gave to a carrier off the platform.
 *
 * The driver is a name and a phone, nothing more — an off-platform driver
 * has no account and no `driver` row, and the phone is the WhatsApp identity
 * the tracking jobs dial.
 *
 * Same recipe as the other portal forms: one builder, a message-free Base
 * variant the procedures validate with, and a factory the form calls with
 * its translated copy.
 */

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.trips`). */
export type TripMessageField =
    | "address"
    | "country"
    | "date"
    | "driver"
    | "phone"
    | "plate"
    | "cargo";

type Message = (field: TripMessageField) => ErrorParam;

export const DRIVER_NAME_MAX = 120;
export const TRUCK_PLATE_MAX = 20;
export const CARGO_MAX = 500;

/**
 * The status vocabulary, restated rather than imported from
 * `@workspace/db/movements`: that module builds drizzle tables at import time and
 * this file is part of the browser bundle the new-trip form ships. The
 * `satisfies` clause pins it to the column's own union, so a change to the
 * database vocabulary fails the typecheck here.
 */
export const TRIP_STATUS = ["scheduled", "in-transit", "delivered", "cancelled"] as const satisfies readonly MovementStatus[];

/** The shape stored in the jsonb location columns (see `Location` in @workspace/db). */
const location = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(error),
    country: z.string().nonempty(error),
    state: z.string().nonempty(error),
});

export function buildCreateTrip(msg: Message) {
    return z.object({
        driverName: z.string().trim().nonempty(msg("driver")).max(DRIVER_NAME_MAX, msg("driver")),
        driverPhone: z.e164(msg("phone")),
        origin: location(msg("address")),
        destination: location(msg("address")),
        truckPlate: z.string().trim().max(TRUCK_PLATE_MAX, msg("plate")).optional(),
        cargoDescription: z.string().trim().max(CARGO_MAX, msg("cargo")).optional(),
        /** The connected partner on the other side, when the load is not the tenant's own */
        counterpartyOrgId: z.string().nonempty().optional(),
        expectedDeliveryAt: z.date(msg("date")).optional(),
        /** "Already on the road": the trip opens in transit and starts spending the plan */
        startNow: z.boolean().default(false),
    });
}

// Message-free variant, used by `trips.create` to validate input
export const CreateTripBaseSchema = buildCreateTrip(() => undefined);

export type CreateTripInput = z.infer<typeof CreateTripBaseSchema>;

/**
 * Everything the trip carries can be corrected while it is still running;
 * the status is not among them — it moves through `trips.setStatus`, which
 * is where the plan gate and the notifications live.
 */
export const UpdateTripBaseSchema = CreateTripBaseSchema
    .omit({ startNow: true })
    .partial()
    .extend({ id: z.string().nonempty() });

export type UpdateTripInput = z.infer<typeof UpdateTripBaseSchema>;

export const SetTripStatusBaseSchema = z.object({
    id: z.string().nonempty(),
    to: z.enum(TRIP_STATUS),
});

export type SetTripStatusInput = z.infer<typeof SetTripStatusBaseSchema>;

/**
 * The client-side shape. `PhoneInput` renders the dial code beside the field
 * and never folds it into the value, so the country travels as a sibling
 * field and `toE164` composes the two at submit — which is what the
 * refinement validates and what the mutation is handed.
 */
export function CreateTripFormSchema(msg: Message) {
    return z
        .object({
            driverName: z.string().trim().nonempty(msg("driver")).max(DRIVER_NAME_MAX, msg("driver")),
            country: z.string().nonempty(msg("country")),
            phoneNumber: z.string().nonempty(msg("phone")),
            origin: location(msg("address")),
            destination: location(msg("address")),
            truckPlate: z.string().trim().max(TRUCK_PLATE_MAX, msg("plate")),
            cargoDescription: z.string().trim().max(CARGO_MAX, msg("cargo")),
            counterpartyOrgId: z.string(),
            expectedDeliveryAt: z.date(msg("date")).optional(),
            startNow: z.boolean(),
        })
        .refine((data) => z.e164().safeParse(toE164(data.country, data.phoneNumber)).success, {
            ...(msg("phone") ?? {}),
            path: ["phoneNumber"],
        });
}

export type CreateTripForm = z.infer<ReturnType<typeof CreateTripFormSchema>>;
