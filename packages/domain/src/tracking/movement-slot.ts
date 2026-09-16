import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import { order } from "@workspace/db/orders";
import { movement, movementTrackingRequest, type Movement, type MovementTrackingRequest } from "@workspace/db/movements";
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

import { movementRef } from "@workspace/domain/movements/refs";
import { TRACKED_STATUSES as TRACKED_MOVEMENT_STATUSES } from "@workspace/domain/movements/status";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { REVIEW_AFTER_MINUTES, reviewMovementSlot } from "@workspace/domain/tracking/movement-review";
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

export type MovementSlotRunSummary = {
    slot: SlotInfo;
    eligible: number;
    sent: number;
    resent: number;
    skipped: number;
    failed: number;
    /** What the end-of-window review judged, 0 on every earlier tick */
    reviewed: number;
    alerts: number;
};

/**
 * Runs one tick of one slot over the movements the portal owns: the order
 * runner (apps/admin/src/lib/tracking/run-slot.ts) with `movement` as its
 * subject, and the same self-healing property — every movement is judged on
 * its own history rather than on the clock, so a duplicate tick is a no-op
 * and a missed one heals on the next.
 *
 * Two things have no equivalent on the order side. A driver Admin is already
 * chasing for a live order is left alone: one phone, one thread, and two
 * systems asking the same question twice an hour is how a driver learns to
 * ignore us. And on the window's last ticks the slot is reviewed and the
 * tenant told what its drivers actually reported, because nobody in the
 * portal is watching a cron log.
 */
export async function runMovementTrackingSlot(db: typeof Database, info: SlotInfo): Promise<MovementSlotRunSummary> {
    const summary: MovementSlotRunSummary = {
        slot: info, eligible: 0, sent: 0, resent: 0, skipped: 0, failed: 0, reviewed: 0, alerts: 0,
    };
    const now = new Date();

    // Before this tick's own sends, never after: a request written seconds ago
    // has had no chance of an answer, and judging it would alert on our own
    // timing rather than on the driver's silence
    if (info.minutesIntoSlot >= REVIEW_AFTER_MINUTES) {
        const review = await reviewMovementSlot(db, info);

        summary.reviewed = review.reviewed;
        summary.alerts = review.alerts;
    }

    // The phones Admin's own cron is pinging for a live order — read before
    // the batch rather than filtered out of it afterwards, so a fleet whose
    // drivers are mostly on Appload orders does not spend its whole tick on
    // movements nobody was going to be pinged for. Matched on the
    // normalized (bare digits) form because orders keep E.164 and movements
    // do too, but neither guarantees the same formatting of it.
    const trackedByAdmin = await db
        .select({ driverPhoneNumber: order.driverPhoneNumber })
        .from(order)
        .where(and(
            inArray(order.status, TRACKED_STATUSES),
            isNotNull(order.driverPhoneNumber),
        ));

    const pingedByAdmin = [...new Set(trackedByAdmin.map((row) => normalizePhone(row.driverPhoneNumber!)))];

    const movements = await db
        .select()
        .from(movement)
        .where(and(
            // From the moment the truck leaves the loading site to the end
            // of offloading, stops included: a truck held up on the road is
            // exactly the one somebody wants a position from, while one
            // still standing at the loading site is where everyone expects
            inArray(movement.status, TRACKED_MOVEMENT_STATUSES),
            eq(movement.trackingEnabled, true),
            // A load may be started with no driver named — that is flagged,
            // never blocked — and there is nobody to ask where it is until
            // somebody names one, so it is skipped here rather than pinged
            // into the void
            isNotNull(movement.driverPhone),
            isNotNull(movement.driverName),
            // Only the row that holds the truck. When A hands a load to B and
            // B accepts, both rows carry this driver: A links down to B, B
            // links nowhere, and B is the one company that asks him. Ask
            // twice and the driver learns to ignore us
            isNull(movement.executionMovementId),
            pingedByAdmin.length > 0
                ? notInArray(sql`regexp_replace(${movement.driverPhone}, '\\D', '', 'g')`, pingedByAdmin)
                : undefined,
        ))
        // Oldest start first: without an order the batch is whatever the
        // scan happens to yield, so which movements a tick covered could
        // not be reasoned about afterwards
        .orderBy(asc(movement.startedAt))
        .limit(BATCH_SIZE);

    summary.eligible = movements.length;

    if (movements.length === 0) {
        return summary;
    }

    // Every row written for this slot, whatever the attempt — the decision
    // for each movement is read from these, never from the firing time
    const priorRows = await db
        .select()
        .from(movementTrackingRequest)
        .where(and(
            eq(movementTrackingRequest.slotDate, info.slotDate),
            eq(movementTrackingRequest.slot, info.slot),
            inArray(movementTrackingRequest.movementId, movements.map((row) => row.id)),
        ));

    const byMovement = new Map<string, MovementTrackingRequest[]>();
    for (const row of priorRows) {
        const list = byMovement.get(row.movementId);
        if (list) list.push(row); else byMovement.set(row.movementId, [row]);
    }

    for (const row of movements) {
        const decision = decideNextAttempt(byMovement.get(row.id) ?? [], now);

        if (decision.action === "skip") {
            summary.skipped++;
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
 * Claims the (movement, slot, attempt) before anything leaves the building:
 * the
 * unique index means a concurrent or repeated run gets zero rows back and
 * walks away.
 */
async function claimAndSend(
    db: typeof Database,
    row: Movement,
    info: SlotInfo,
    attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
    // Ensure the thread exists (idempotent) so the ping is always mirrored
    // into chat — but a chat failure must never block the ping itself
    let conversationId = row.conversationId;

    try {
        const { conversation } = await startConversation(db, {
            driverName: row.driverName!,
            driverPhone: row.driverPhone!,
        });

        conversationId = conversation.id;

        // A movement is registered from a phone number alone; which thread
        // that number belongs to is only settled the first time we write to it
        if (!row.conversationId) {
            await db
                .update(movement)
                .set({ conversationId })
                .where(eq(movement.id, row.id));
        }
    } catch (error) {
        console.error(`tracking: ensure conversation failed for ${movementRef(row)}`, error);
    }

    const [claim] = await db
        .insert(movementTrackingRequest)
        .values({
            movementId: row.id,
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
    row: Movement,
    claim: MovementTrackingRequest,
): Promise<"sent" | "failed"> {
    const reference = movementRef(row);

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
        ? smsRequestText(row.driverName!, reference, route)
        : direct
            ? locationRequestText(reference, route)
            : trackingTemplateText(row.driverName!, reference, row.truckPlate ?? "—", route.origin, route.destination);

    const result = claim.channel === "sms"
        ? await sendSmsText(row.driverPhone!, body)
        : direct
            ? await sendWhatsAppLocationRequest(row.driverPhone!, body)
            : await sendWhatsAppTemplate(
                row.driverPhone!,
                [row.driverName!, reference, row.truckPlate ?? "—", route.origin, route.destination],
                shareLocationPayload(reference),
            );

    await db
        .update(movementTrackingRequest)
        .set(result.ok
            ? { status: "sent", externalId: result.externalId, error: null }
            : { status: "failed", error: result.error })
        .where(eq(movementTrackingRequest.id, claim.id));

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
