import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { order, type Order } from "@workspace/db/orders";
import { chatConversation, chatMessage, trackingRequest, type TrackingRequest } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";
import {
    locationRequestText,
    sendSmsText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";

import { startConversation } from "@workspace/domain/tracking/conversations";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";
import {
    BATCH_SIZE,
    channelFor,
    decideNextAttempt,
    hasOpenSession,
    place,
    smsText,
    type SlotInfo,
} from "@workspace/domain/tracking/slot";

export { TRACKED_STATUSES };

export type SlotRunSummary = {
    slot: SlotInfo;
    eligible: number;
    sent: number;
    resent: number;
    skipped: number;
    failed: number;
};

/**
 * Runs one tick of one slot. Every order is judged on its own history
 * rather than on the clock, so the sweep is idempotent under duplicate
 * deliveries and self-healing when a tick is missed entirely: if the 08:00
 * fire never happens, the 08:15 one sends attempt 1.
 */
export async function runTrackingSlot(db: typeof Database, info: SlotInfo): Promise<SlotRunSummary> {
    const summary: SlotRunSummary = { slot: info, eligible: 0, sent: 0, resent: 0, skipped: 0, failed: 0 };
    const now = new Date();

    const orders = await db
        .select()
        .from(order)
        .where(and(
            inArray(order.status, TRACKED_STATUSES),
            isNotNull(order.driverPhoneNumber),
        ))
        .limit(BATCH_SIZE);

    summary.eligible = orders.length;

    if (orders.length === 0) {
        return summary;
    }

    // Every row written for this slot, whatever the attempt — the decision
    // for each order is read from these, never from the firing time
    const priorRows = await db
        .select()
        .from(trackingRequest)
        .where(and(
            eq(trackingRequest.slotDate, info.slotDate),
            eq(trackingRequest.slot, info.slot),
            inArray(trackingRequest.orderId, orders.map((row) => row.id)),
        ));

    const byOrder = new Map<string, TrackingRequest[]>();
    for (const row of priorRows) {
        const list = byOrder.get(row.orderId);
        if (list) list.push(row); else byOrder.set(row.orderId, [row]);
    }

    for (const row of orders) {
        const decision = decideNextAttempt(byOrder.get(row.id) ?? [], now);

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
 * Claims the (order, slot, attempt) before anything leaves the building:
 * the unique index means a concurrent or repeated run gets zero rows back
 * and walks away.
 */
async function claimAndSend(
    db: typeof Database,
    row: Order,
    info: SlotInfo,
    attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
    // Ensure the thread exists (idempotent) so the ping is always mirrored
    // into chat — but a chat failure must never block the ping itself
    let conversationId: string | null = null;

    try {
        const { conversation } = await startConversation(db, {
            driverName: row.driverName ?? row.driverPhoneNumber!,
            driverPhone: row.driverPhoneNumber!,
            orderId: row.orderId,
        });

        conversationId = conversation.id;
    } catch (error) {
        console.error(`tracking: ensure conversation failed for ${row.orderId}`, error);
    }

    const [claim] = await db
        .insert(trackingRequest)
        .values({
            orderId: row.id,
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
    row: Order,
    claim: TrackingRequest,
): Promise<"sent" | "failed"> {
    const phone = row.driverPhoneNumber!;
    const driverName = row.driverName ?? "motorista";

    // One step instead of two whenever WhatsApp allows it: an open session
    // window means the native location request (with its built-in "Send
    // location" button) can go out directly, no template tap needed. Only
    // attempt 1 takes the shortcut — a driver who ignored it gets the
    // template on attempt 2, whose tap re-triggers the request via the
    // webhook, before attempt 3 escalates to SMS.
    const direct = claim.channel === "whatsapp"
        && claim.attempt === 1
        && await hasOpenSession(db, claim.conversationId);

    const route = {
        truckPlate: row.truckPlate,
        origin: place(row.loadingAddress),
        destination: place(row.offloadingAddress),
    };

    const body = claim.channel === "sms"
        ? smsText(driverName, row)
        : direct
            ? locationRequestText(row.orderId, route)
            : trackingTemplateText(driverName, row.orderId, row.truckPlate ?? "—", route.origin, route.destination);

    const result = claim.channel === "sms"
        ? await sendSmsText(phone, body)
        : direct
            ? await sendWhatsAppLocationRequest(phone, body)
            : await sendWhatsAppTemplate(
                phone,
                [driverName, row.orderId, row.truckPlate ?? "—", route.origin, route.destination],
                shareLocationPayload(row.orderId),
            );

    await db
        .update(trackingRequest)
        .set(result.ok
            ? { status: "sent", externalId: result.externalId, error: null }
            : { status: "failed", error: result.error })
        .where(eq(trackingRequest.id, claim.id));

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
