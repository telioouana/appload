import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { chatConversation, chatMessage, trackingRequest } from "@workspace/db/chats";

import { parseDeliveryReports, parseInboundWebhook } from "@/lib/chats/infobip";

/**
 * Constant-time compare that does not leak the secret's length. timingSafeEqual
 * throws on mismatched buffer sizes, so both sides are hashed to a fixed width
 * first.
 */
function secretMatches(provided: string | null, expected: string): boolean {
    if (!provided) return false;

    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(expected).digest();

    return timingSafeEqual(a, b);
}

/**
 * Infobip webhook: inbound WhatsApp/SMS messages AND delivery reports both
 * land here (point both Infobip configurations at POST /api/chats/infobip).
 * Requests must carry INFOBIP_WEBHOOK_SECRET in the "x-webhook-secret" header.
 *
 * This fails closed, matching lib/cron/verify.ts: an unset secret rejects
 * every request rather than disabling the check. Writes here mark tracking
 * requests answered, which stops the tracking cron chasing a live load — so
 * an unauthenticated caller must never reach them.
 */
export async function POST(request: NextRequest) {
    const secret = process.env.INFOBIP_WEBHOOK_SECRET;

    if (!secret) {
        console.error("[infobip] INFOBIP_WEBHOOK_SECRET is not set — rejecting webhook");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!secretMatches(request.headers.get("x-webhook-secret"), secret)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let payload: unknown;

    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    // Delivery reports: flip message + tracking-request status by Infobip id.
    // "responded" outranks "delivered" outranks "failed" — never downgrade.
    const reports = parseDeliveryReports(payload);

    for (const report of reports) {
        await db
            .update(chatMessage)
            .set({ status: report.status === "delivered" ? "delivered" : "failed" })
            .where(and(
                eq(chatMessage.externalId, report.externalId),
                inArray(chatMessage.status, ["pending", "sent"]),
            ));

        await db
            .update(trackingRequest)
            .set({ status: report.status })
            .where(and(
                eq(trackingRequest.externalId, report.externalId),
                inArray(trackingRequest.status, ["pending", "sent"]),
            ));
    }

    const inbound = parseInboundWebhook(payload);
    let stored = 0;

    for (const message of inbound) {
        // Find (or create) the conversation for this phone number
        let [conversation] = await db
            .select()
            .from(chatConversation)
            .where(eq(chatConversation.driverPhone, message.phone))
            .limit(1);

        if (!conversation) {
            // Unknown sender: open a conversation named after the number so
            // the message is never lost; ops can rename/link it later
            [conversation] = await db
                .insert(chatConversation)
                .values({ driverName: message.phone, driverPhone: message.phone })
                .returning();
        }

        if (!conversation) {
            continue;
        }

        const [saved] = await db
            .insert(chatMessage)
            .values({
                conversationId: conversation.id,
                direction: "inbound",
                body: message.text,
                externalId: message.externalId,
            })
            .returning();

        if (saved) {
            stored += 1;
            await db
                .update(chatConversation)
                .set({ lastMessageAt: saved.createdAt })
                .where(eq(chatConversation.id, conversation.id));

            // Any reply from the driver answers every open location request
            // on their thread — the cron skips further attempts
            await db
                .update(trackingRequest)
                .set({ status: "responded" })
                .where(and(
                    eq(trackingRequest.conversationId, conversation.id),
                    inArray(trackingRequest.status, ["pending", "sent", "delivered"]),
                ));
        }
    }

    return NextResponse.json({ received: inbound.length, stored: stored, reports: reports.length });
}
