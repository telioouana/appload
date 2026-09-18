/**
 * Where a movement driver's shared location becomes a tracking ping.
 *
 * The mirror of locations.ts over the movement tables: the same attribution
 * problem (chats are keyed by phone, movements by their own id) and the same
 * rule that a pin must never cost us the message — so these stay pure data
 * access and the webhook owns the error handling.
 */

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { movement, movementLocation, movementTrackingRequest } from "@workspace/db/movements";
import type { db as Database } from "@workspace/db/db";
import type { DeliveryReport } from "@workspace/comms/infobip";
import { normalizePhone } from "@workspace/comms/phone";

import { IN_PROGRESS_STATUSES } from "@workspace/domain/movements/status";

/**
 * The movement a conversation's pin belongs to. Runs only after the order
 * attribution came back empty: an Appload order always wins, because its
 * trail is the one operations and the logbook are built on.
 *
 * A candidate is any movement being tracked on this thread or on this
 * sender's number, and only ever the **terminal** one — the row with a driver
 * phone and nobody linked below it. That last clause is what makes a
 * subcontract work: when A hands a load to B and B accepts, both companies
 * hold a row carrying this driver's number, but only B's row is the truck.
 * Without it the multi-organization guard below would refuse every pin on a
 * subcontracted load and the trail would silently stay empty; with it, A
 * reads the same trail by projection.
 *
 * Among the candidates:
 *  1. no tenant proves it owns the number it typed, so candidates spread
 *     over more than one organization mean the pin has no honest owner and
 *     it is dropped — picking one would hand that tenant another's trail
 *     (and close the other's open requests with it);
 *  2. otherwise the movement whose location request this answers, which is
 *     the only thing that tells two of one tenant's loads apart;
 *  3. otherwise the movement pointing at this thread, else the newest one.
 */
export async function resolveMovementForConversation(
    db: typeof Database,
    conversation: { conversationId: string; driverPhone: string },
): Promise<{
    id: string;
    reference: string | null;
    requestReference: string | null;
    clientReference: string | null;
    organizationId: string;
} | null> {
    const running = await db
        .select({
            id: movement.id,
            reference: movement.reference,
            requestReference: movement.requestReference,
            clientReference: movement.clientReference,
            organizationId: movement.organizationId,
            conversationId: movement.conversationId,
            driverPhone: movement.driverPhone,
        })
        .from(movement)
        .where(and(
            // In progress only, stops included: a booked load has no truck at
            // it yet, and a delivered one keeps its thread — the driver's
            // next job must not land on the finished one
            inArray(movement.status, IN_PROGRESS_STATUSES),
            eq(movement.trackingEnabled, true),
            isNotNull(movement.driverPhone),
            // Only the row that actually holds the truck — see above
            isNull(movement.executionMovementId),
            // A load linked to an Appload order is that order's pin: the
            // order attribution above already claimed it, and a second trail
            // for the same truck would be the same pings counted twice
            isNull(movement.orderId),
        ))
        .orderBy(desc(movement.createdAt));

    // The phone match runs in JS because conversations store bare digits
    // while movements keep E.164. A thread is keyed on the phone alone, so
    // the two halves of this are very nearly the same set.
    const candidates = running.filter((row) =>
        row.conversationId === conversation.conversationId
        || normalizePhone(row.driverPhone!) === conversation.driverPhone
    );

    if (candidates.length === 0) return null;

    if (new Set(candidates.map((row) => row.organizationId)).size > 1) {
        console.warn(
            `movement attribution refused for conversation ${conversation.conversationId}: live movements of more than one organization carry this driver`,
        );
        return null;
    }

    const [asked] = await db
        .select({ movementId: movementTrackingRequest.movementId })
        .from(movementTrackingRequest)
        .where(and(
            eq(movementTrackingRequest.conversationId, conversation.conversationId),
            inArray(movementTrackingRequest.status, ["sent", "delivered"]),
            inArray(movementTrackingRequest.movementId, candidates.map((row) => row.id)),
        ))
        .orderBy(desc(movementTrackingRequest.createdAt))
        .limit(1);

    const active =
        candidates.find((row) => row.id === asked?.movementId)
        ?? candidates.find((row) => row.conversationId === conversation.conversationId)
        ?? candidates[0];

    return active
        ? {
            id: active.id,
            reference: active.reference,
            requestReference: active.requestReference,
            clientReference: active.clientReference,
            organizationId: active.organizationId,
        }
        : null;
}

/**
 * Stores one ping against a movement. `movementId` is the movement's uuid PK
 * (what resolveMovementForConversation returns as `id`), not the reference
 * the company knows it by.
 *
 * Idempotent per chat message for the same reason the order trail is
 * (locations.ts): the unique chatMessageId turns a replay into a no-op and
 * returns false, so true means this call is the one that created the trail
 * point. The webhook still has to recognize a retried delivery first — the
 * retry arrives as a new chat message row, which this cannot see through.
 */
export async function recordMovementLocation(
    db: typeof Database,
    input: {
        movementId: string;
        conversationId: string;
        chatMessageId: string;
        latitude: number;
        longitude: number;
        placeName: string | null;
        // Reverse-geocoded by the caller when it could; a null is filled in
        // later by the map overview (place-labels.ts)
        placeLabel?: string | null;
        recordedAt: Date;
    },
): Promise<boolean> {
    const inserted = await db
        .insert(movementLocation)
        .values({
            movementId: input.movementId,
            conversationId: input.conversationId,
            chatMessageId: input.chatMessageId,
            latitude: input.latitude,
            longitude: input.longitude,
            placeName: input.placeName,
            placeLabel: input.placeLabel ?? null,
            source: "whatsapp",
            recordedAt: input.recordedAt,
        })
        .onConflictDoNothing()
        .returning({ id: movementLocation.id });

    return inserted.length > 0;
}

/**
 * Closes every open location request on a thread: any real reply from the
 * driver answers the movement's slot, exactly as it answers an order's. A
 * phone that carries both an order and a movement closes both, which is
 * right — the driver did answer, and asking again would be noise.
 */
export async function respondMovementRequests(db: typeof Database, conversationId: string): Promise<void> {
    await db
        .update(movementTrackingRequest)
        .set({ status: "responded" })
        .where(and(
            eq(movementTrackingRequest.conversationId, conversationId),
            inArray(movementTrackingRequest.status, ["pending", "sent", "delivered"]),
        ));
}

/**
 * Carries an Infobip delivery report onto the movement's request row, the way
 * the webhook already carries it onto an order's. The decision table drops the
 * SMS escalation when the second WhatsApp attempt was *delivered* and simply
 * went unanswered (slot.ts) — a status only a report can write, so without
 * this the portal pays for an SMS to a driver whose phone demonstrably
 * receives us.
 *
 * The same "never downgrade" guard the webhook states: a report that arrives
 * after the driver already answered leaves "responded" alone.
 */
export async function reportMovementDelivery(db: typeof Database, report: DeliveryReport): Promise<void> {
    await db
        .update(movementTrackingRequest)
        .set({ status: report.status })
        .where(and(
            eq(movementTrackingRequest.externalId, report.externalId),
            inArray(movementTrackingRequest.status, ["pending", "sent"]),
        ));
}
