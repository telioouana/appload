import { z } from "zod";

import { ORDER_STATUS } from "@workspace/db/types";

/**
 * The carrier side of an order: sending the rig to load, moving the trip
 * along the chain, and the proof it uploads on the way.
 *
 * Dispatch is not a form of its own — it is the payload `booked → at-loading`
 * carries. The picker chooses from the carrier's OWN registered fleet and
 * drivers, and the procedure re-checks every id against `carrier_id = T`
 * before it writes the driver and plate columns the transition then gates on.
 */

export type ErrorParam = { error: string } | undefined;

/** The message key each field's error comes from (see `App.orders`). */
export type DispatchMessageField = "driver" | "truck" | "note" | "document";

type Message = (field: DispatchMessageField) => ErrorParam;

export const NOTE_MIN = 5;
export const NOTE_MAX = 2000;

/** The documents a partner may attach to an order (Appload owns the rest). */
export const PARTNER_DOCUMENT_TYPES = ["pod", "evidence"] as const;
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number];

/**
 * An upload backing a move. The URL is an EdgeStore one — the procedure
 * refuses anything else, so a link to another host can never be stored as
 * this order's proof.
 */
export const TransitionDocumentSchema = z.object({
    type: z.enum(PARTNER_DOCUMENT_TYPES),
    url: z.url(),
    title: z.string().trim().max(200).optional(),
    size: z.number().int().positive().optional(),
    mimeType: z.string().trim().max(100).optional(),
});

export type TransitionDocumentForm = z.infer<typeof TransitionDocumentSchema>;

export function buildDispatch(msg: Message) {
    return z.object({
        driverId: z.string().nonempty(msg("driver")),
        truckId: z.string().nonempty(msg("truck")),
        trailerId: z.string().nonempty().optional(),
        linkId: z.string().nonempty().optional(),
    });
}

export const DispatchBaseSchema = buildDispatch(() => undefined);

export type DispatchForm = z.infer<typeof DispatchBaseSchema>;

/** Client-side variant with translated error messages. */
export function DispatchSchema(msg: Message) {
    return buildDispatch(msg);
}

export function buildTransition(msg: Message) {
    return z.object({
        orderId: z.string().nonempty(),
        to: z.enum(ORDER_STATUS),
        expectedVersion: z.number().int().min(1),
        note: z.string().trim().min(NOTE_MIN, msg("note")).max(NOTE_MAX, msg("note")).optional(),
        /** Required by the dispatch (booked → `at-loading`), ignored by every other move */
        dispatch: buildDispatch(msg).optional(),
        /** Proof attached to the move; also lands on the order's documents */
        document: TransitionDocumentSchema.optional(),
    });
}

export const TransitionBaseSchema = buildTransition(() => undefined);

export type TransitionForm = z.infer<typeof TransitionBaseSchema>;

/** Client-side variant with translated error messages. */
export function TransitionSchema(msg: Message) {
    return buildTransition(msg);
}

/** A document uploaded on its own, outside a status change. */
export const AddDocumentBaseSchema = TransitionDocumentSchema.extend({
    orderId: z.string().nonempty(),
});

export type AddDocumentForm = z.infer<typeof AddDocumentBaseSchema>;
