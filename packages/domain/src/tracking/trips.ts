/**
 * Where a trip driver's shared location becomes a tracking ping.
 *
 * The mirror of locations.ts over the trip tables: the same attribution
 * problem (chats are keyed by phone, trips by their own id) and the same
 * rule that a pin must never cost us the message — so these stay pure data
 * access and the webhook owns the error handling.
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { trip, tripLocation, tripTrackingRequest } from "@workspace/db/trips";
import type { db as Database } from "@workspace/db/db";
import type { DeliveryReport } from "@workspace/comms/infobip";
import { normalizePhone } from "@workspace/comms/phone";

/**
 * The trip a conversation's pin belongs to. Runs only after the order
 * attribution came back empty: an Appload order always wins, because its
 * trail is the one operations and the logbook are built on.
 *
 * Attribution, in order:
 *  1. the thread the trip itself points at — written by the first location
 *     request the portal's cron sent, so it is the strongest link there is;
 *  2. otherwise the driver's newest running trip — the phone match runs in
 *     JS because conversations store bare digits while trips keep E.164.
 *     Newest wins; a driver on two live trips at once is the one case this
 *     cannot disambiguate.
 *
 * Both branches look at in-transit trips only: a delivered trip keeps its
 * thread, and the driver's next job must not land on the finished one.
 */
export async function resolveTripForConversation(
    db: typeof Database,
    conversation: { conversationId: string; driverPhone: string },
): Promise<{ id: string; seq: number; organizationId: string; counterpartyOrgId: string | null } | null> {
    const [linked] = await db
        .select({
            id: trip.id,
            seq: trip.seq,
            organizationId: trip.organizationId,
            counterpartyOrgId: trip.counterpartyOrgId,
        })
        .from(trip)
        .where(and(
            eq(trip.conversationId, conversation.conversationId),
            eq(trip.status, "in-transit"),
        ))
        .orderBy(desc(trip.createdAt))
        .limit(1);

    if (linked) {
        return linked;
    }

    const candidates = await db
        .select({
            id: trip.id,
            seq: trip.seq,
            organizationId: trip.organizationId,
            counterpartyOrgId: trip.counterpartyOrgId,
            driverPhone: trip.driverPhone,
        })
        .from(trip)
        .where(eq(trip.status, "in-transit"))
        .orderBy(desc(trip.createdAt));

    const active = candidates.find(
        (row) => normalizePhone(row.driverPhone) === conversation.driverPhone,
    );

    return active
        ? {
            id: active.id,
            seq: active.seq,
            organizationId: active.organizationId,
            counterpartyOrgId: active.counterpartyOrgId,
        }
        : null;
}

/**
 * Stores one ping against a trip. `tripId` is the trip's uuid PK (what
 * resolveTripForConversation returns as `id`), not the "TRP-<seq>" reference.
 *
 * Idempotent per chat message for the same reason the order trail is
 * (locations.ts): the unique chatMessageId turns a replay into a no-op and
 * returns false, so true means this call is the one that created the trail
 * point. The webhook still has to recognize a retried delivery first — the
 * retry arrives as a new chat message row, which this cannot see through.
 */
export async function recordTripLocation(
    db: typeof Database,
    input: {
        tripId: string;
        conversationId: string;
        chatMessageId: string;
        latitude: number;
        longitude: number;
        placeName: string | null;
        recordedAt: Date;
    },
): Promise<boolean> {
    const inserted = await db
        .insert(tripLocation)
        .values({
            tripId: input.tripId,
            conversationId: input.conversationId,
            chatMessageId: input.chatMessageId,
            latitude: input.latitude,
            longitude: input.longitude,
            placeName: input.placeName,
            source: "whatsapp",
            recordedAt: input.recordedAt,
        })
        .onConflictDoNothing()
        .returning({ id: tripLocation.id });

    return inserted.length > 0;
}

/**
 * Closes every open location request on a thread: any real reply from the
 * driver answers the trip's slot, exactly as it answers an order's. A phone
 * that carries both an order and a trip closes both, which is right — the
 * driver did answer, and asking again would be noise.
 */
export async function respondTripRequests(db: typeof Database, conversationId: string): Promise<void> {
    await db
        .update(tripTrackingRequest)
        .set({ status: "responded" })
        .where(and(
            eq(tripTrackingRequest.conversationId, conversationId),
            inArray(tripTrackingRequest.status, ["pending", "sent", "delivered"]),
        ));
}

/**
 * Carries an Infobip delivery report onto the trip's request row, the way the
 * webhook already carries it onto an order's. The decision table drops the SMS
 * escalation when the second WhatsApp attempt was *delivered* and simply went
 * unanswered (slot.ts) — a status only a report can write, so without this the
 * portal pays for an SMS to a driver whose phone demonstrably receives us.
 *
 * The same "never downgrade" guard the webhook states: a report that arrives
 * after the driver already answered leaves "responded" alone.
 */
export async function reportTripDelivery(db: typeof Database, report: DeliveryReport): Promise<void> {
    await db
        .update(tripTrackingRequest)
        .set({ status: report.status })
        .where(and(
            eq(tripTrackingRequest.externalId, report.externalId),
            inArray(tripTrackingRequest.status, ["pending", "sent"]),
        ));
}
