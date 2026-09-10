import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import { order } from "@workspace/db/orders";
import { trip, tripTrackingRequest, type Trip, type TripTrackingRequest } from "@workspace/db/trips";
import type { db as Database } from "@workspace/db/db";
import {
    locationRequestText,
    sendSmsText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";
import { normalizePhone } from "@workspace/comms/phone";

import { notify } from "@workspace/domain/notifications";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";
import {
    BATCH_SIZE,
    channelFor,
    decideNextAttempt,
    hasOpenSession,
    place,
    smsRequestText,
    type SlotInfo,
} from "@workspace/domain/tracking/slot";

export type TripSlotRunSummary = {
    slot: SlotInfo;
    eligible: number;
    sent: number;
    resent: number;
    skipped: number;
    failed: number;
    notified: number;
};

/**
 * Runs one tick of one slot over standalone trips: the order runner
 * (apps/admin/src/lib/tracking/run-slot.ts) with `trip` as its subject, and
 * the same self-healing property — every trip is judged on its own history
 * rather than on the clock, so a duplicate tick is a no-op and a missed one
 * heals on the next.
 *
 * Two things have no equivalent on the order side. A driver Admin is already
 * chasing for a live order is left alone: one phone, one thread, and two
 * systems asking the same question twice an hour is how a driver learns to
 * ignore us. And a slot whose attempts run out tells the tenant, because
 * nobody in the portal is watching a cron log.
 */
export async function runTripTrackingSlot(db: typeof Database, info: SlotInfo): Promise<TripSlotRunSummary> {
    const summary: TripSlotRunSummary = {
        slot: info, eligible: 0, sent: 0, resent: 0, skipped: 0, failed: 0, notified: 0,
    };
    const now = new Date();

    // The phones Admin's own cron is pinging for a live order — read before
    // the batch rather than filtered out of it afterwards, so a fleet whose
    // drivers are mostly on Appload orders does not spend its whole tick on
    // trips nobody was going to be pinged for. Matched on the normalized
    // (bare digits) form because orders keep E.164 and trips do too, but
    // neither guarantees the same formatting of it.
    const trackedByAdmin = await db
        .select({ driverPhoneNumber: order.driverPhoneNumber })
        .from(order)
        .where(and(
            inArray(order.status, TRACKED_STATUSES),
            isNotNull(order.driverPhoneNumber),
        ));

    const pingedByAdmin = [...new Set(trackedByAdmin.map((row) => normalizePhone(row.driverPhoneNumber!)))];

    const trips = await db
        .select()
        .from(trip)
        .where(and(
            eq(trip.status, "in-transit"),
            eq(trip.trackingEnabled, true),
            pingedByAdmin.length > 0
                ? notInArray(sql`regexp_replace(${trip.driverPhone}, '\\D', '', 'g')`, pingedByAdmin)
                : undefined,
        ))
        // Oldest departure first: without an order the batch is whatever the
        // scan happens to yield, so which trips a tick covered could not be
        // reasoned about afterwards
        .orderBy(asc(trip.startedAt))
        .limit(BATCH_SIZE);

    summary.eligible = trips.length;

    if (trips.length === 0) {
        return summary;
    }

    // Every row written for this slot, whatever the attempt — the decision
    // for each trip is read from these, never from the firing time
    const priorRows = await db
        .select()
        .from(tripTrackingRequest)
        .where(and(
            eq(tripTrackingRequest.slotDate, info.slotDate),
            eq(tripTrackingRequest.slot, info.slot),
            inArray(tripTrackingRequest.tripId, trips.map((row) => row.id)),
        ));

    const byTrip = new Map<string, TripTrackingRequest[]>();
    for (const row of priorRows) {
        const list = byTrip.get(row.tripId);
        if (list) list.push(row); else byTrip.set(row.tripId, [row]);
    }

    for (const row of trips) {
        const decision = decideNextAttempt(byTrip.get(row.id) ?? [], now);

        if (decision.action === "skip") {
            summary.skipped++;

            if (decision.exhausted && await raiseNoResponse(db, row, info)) {
                summary.notified++;
            }

            continue;
        }

        const outcome = decision.action === "resend"
            ? await send(db, row, decision.row)
            : await claimAndSend(db, row, info, decision.attempt);

        if (outcome === "sent") {
            summary.sent++;
            if (decision.action === "resend") summary.resent++;
        } else if (outcome === "failed") {
            summary.failed++;
        } else {
            summary.skipped++;
        }
    }

    return summary;
}

/**
 * Tells the tenant its driver went quiet for a whole slot. The dedupe key is
 * the slot, not the tick, so every later tick of the same slot writes nothing
 * and the tenant hears about it once.
 */
async function raiseNoResponse(db: typeof Database, row: Trip, info: SlotInfo): Promise<boolean> {
    const written = await notify(db, {
        organizationId: row.organizationId,
        kind: "trip.no-response",
        entityType: "trip",
        entityId: row.id,
        params: { ref: `TRP-${row.seq}`, driverName: row.driverName },
        email: true,
        dedupeKey: `trip:${row.id}:${info.slotDate}:${info.slot}`,
    });

    return written > 0;
}

/**
 * Claims the (trip, slot, attempt) before anything leaves the building: the
 * unique index means a concurrent or repeated run gets zero rows back and
 * walks away.
 */
async function claimAndSend(
    db: typeof Database,
    row: Trip,
    info: SlotInfo,
    attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
    // Ensure the thread exists (idempotent) so the ping is always mirrored
    // into chat — but a chat failure must never block the ping itself
    let conversationId = row.conversationId;

    try {
        const { conversation } = await startConversation(db, {
            driverName: row.driverName,
            driverPhone: row.driverPhone,
        });

        conversationId = conversation.id;

        // A trip is registered from a phone number alone; which thread that
        // number belongs to is only settled the first time we write to it
        if (!row.conversationId) {
            await db
                .update(trip)
                .set({ conversationId })
                .where(eq(trip.id, row.id));
        }
    } catch (error) {
        console.error(`tracking: ensure conversation failed for TRP-${row.seq}`, error);
    }

    const [claim] = await db
        .insert(tripTrackingRequest)
        .values({
            tripId: row.id,
            conversationId,
            slotDate: info.slotDate,
            slot: info.slot,
            attempt,
            channel: channelFor(attempt),
            scheduledFor: new Date(),
        })
        .onConflictDoNothing()
        .returning();

    if (!claim) {
        return "skipped";
    }

    return send(db, row, claim);
}

/** Sends the message a claim row stands for and records the outcome. */
async function send(
    db: typeof Database,
    row: Trip,
    claim: TripTrackingRequest,
): Promise<"sent" | "failed"> {
    const reference = `TRP-${row.seq}`;

    // One step instead of two whenever WhatsApp allows it, and only on
    // attempt 1 — the order runner carries the full reasoning
    const direct = claim.channel === "whatsapp"
        && claim.attempt === 1
        && await hasOpenSession(db, claim.conversationId);

    const route = {
        truckPlate: row.truckPlate,
        origin: place(row.origin),
        destination: place(row.destination),
    };

    const body = claim.channel === "sms"
        ? smsRequestText(row.driverName, reference, route)
        : direct
            ? locationRequestText(reference, route)
            : trackingTemplateText(row.driverName, reference, row.truckPlate ?? "—", route.origin, route.destination);

    const result = claim.channel === "sms"
        ? await sendSmsText(row.driverPhone, body)
        : direct
            ? await sendWhatsAppLocationRequest(row.driverPhone, body)
            : await sendWhatsAppTemplate(
                row.driverPhone,
                [row.driverName, reference, row.truckPlate ?? "—", route.origin, route.destination],
                shareLocationPayload(reference),
            );

    await db
        .update(tripTrackingRequest)
        .set(result.ok
            ? { status: "sent", externalId: result.externalId, error: null }
            : { status: "failed", error: result.error })
        .where(eq(tripTrackingRequest.id, claim.id));

    // Mirror the outbound ping into the chat thread so operators see the
    // whole exchange in one place
    if (result.ok && claim.conversationId) {
        const [message] = await db
            .insert(chatMessage)
            .values({
                conversationId: claim.conversationId,
                direction: "outbound",
                body,
                status: "sent",
                externalId: result.externalId,
            })
            .returning();

        if (message) {
            await db
                .update(chatConversation)
                .set({ lastMessageAt: message.createdAt })
                .where(eq(chatConversation.id, claim.conversationId));
        }
    }

    return result.ok ? "sent" : "failed";
}
