import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { chatConversation, chatMessage, trackingRequest } from "@workspace/db/chats";
import {
    locationRequestText,
    parseDeliveryReports,
    parseInboundWebhook,
    sendWhatsAppLocationRequest,
    SHARE_LOCATION_PAYLOAD,
} from "@workspace/comms/infobip";
import { normalizePhone } from "@workspace/comms/phone";
import { secretMatches } from "@workspace/comms/cron";

import { recordOrderLocation, resolveOrderForConversation } from "@workspace/domain/tracking/locations";

/**
 * Infobip webhook: inbound WhatsApp/SMS messages AND delivery reports both
 * land here (point both Infobip configurations at POST /api/chats/infobip).
 * Requests must carry INFOBIP_WEBHOOK_SECRET in the "x-webhook-secret" header.
 *
 * Inbound location pins are also recorded as tracking points against the
 * driver's load (lib/tracking/locations.ts), which is what puts the truck on
 * the map — best effort, after the message itself is safely stored.
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
        // Find (or create) the conversation for this phone number — matched
        // on the normalized bare-digit form so it lands in the same thread
        // the order-side hooks create from E.164 numbers
        const phone = normalizePhone(message.phone);

        if (!phone) {
            continue;
        }

        let [conversation] = await db
            .select()
            .from(chatConversation)
            .where(eq(chatConversation.driverPhone, phone))
            .limit(1);

        if (!conversation) {
            // Unknown sender: open a conversation named after the number so
            // the message is never lost; ops can rename/link it later
            [conversation] = await db
                .insert(chatConversation)
                .values({ driverName: phone, driverPhone: phone })
                .returning();
        }

        if (!conversation) {
            continue;
        }

        // Infobip retries a webhook it did not see acknowledged, and
        // chat_message.external_id carries no unique constraint — so the
        // replay is caught here. Without it the retry inserts a second row
        // with a fresh id, which walks past the ping's one-row-per-chat-message
        // uniqueness and writes the same position onto the trail twice (and
        // re-sends the location request a button tap already answered).
        if (message.externalId) {
            const [replay] = await db
                .select({ id: chatMessage.id })
                .from(chatMessage)
                .where(and(
                    eq(chatMessage.conversationId, conversation.id),
                    eq(chatMessage.direction, "inbound"),
                    eq(chatMessage.externalId, message.externalId),
                ))
                .limit(1);

            if (replay) {
                continue;
            }
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

            if (message.kind === "button") {
                // A tap on the template's "share location" button opens the
                // 24h session window but carries no location yet — answer
                // with WhatsApp's native location-request so the picker is
                // one tap away. The tracking request stays open until the
                // location (or any typed reply) arrives.
                if (message.buttonPayload?.startsWith(SHARE_LOCATION_PAYLOAD)) {
                    const orderId = message.buttonPayload.split(":")[1] || null;
                    const text = locationRequestText(orderId);
                    const result = await sendWhatsAppLocationRequest(phone, text);

                    if (!result.ok) {
                        console.error("[infobip] location request send failed:", result.error);
                    }

                    // Store the follow-up either way so the thread shows what
                    // happened; failed sends stay visible with their status
                    const [reply] = await db
                        .insert(chatMessage)
                        .values({
                            conversationId: conversation.id,
                            direction: "outbound",
                            body: text,
                            status: result.ok ? "sent" : "failed",
                            externalId: result.ok ? result.externalId : null,
                        })
                        .returning();

                    if (reply) {
                        await db
                            .update(chatConversation)
                            .set({ lastMessageAt: reply.createdAt })
                            .where(eq(chatConversation.id, conversation.id));
                    }
                }
            } else {
                // A real reply (typed text or a location pin) answers every
                // open location request on the thread — the cron skips
                // further attempts
                await db
                    .update(trackingRequest)
                    .set({ status: "responded" })
                    .where(and(
                        eq(trackingRequest.conversationId, conversation.id),
                        inArray(trackingRequest.status, ["pending", "sent", "delivered"]),
                    ));

                // A pin is the payload we actually asked for: attribute it to
                // the driver's load so it joins the map trail. Deliberately
                // best-effort — the message is already stored, and throwing
                // here would make Infobip retry the whole batch and duplicate
                // the thread. An unattributed pin stays readable in the chat.
                if (message.kind === "location" && message.location) {
                    try {
                        const active = await resolveOrderForConversation(db, {
                            orderId: conversation.orderId,
                            driverPhone: conversation.driverPhone,
                        });

                        if (active) {
                            await recordOrderLocation(db, {
                                orderId: active.id,
                                conversationId: conversation.id,
                                chatMessageId: saved.id,
                                latitude: message.location.latitude,
                                longitude: message.location.longitude,
                                placeName: message.location.name,
                                // When the driver sent it, not when we got
                                // round to storing it: a backlog of queued
                                // webhooks would otherwise land the whole
                                // batch on the recovery minute and report
                                // hours-old positions as fresh. Our own row's
                                // timestamp is the fallback.
                                recordedAt: message.receivedAt ?? saved.createdAt,
                            });
                        } else {
                            console.warn("[infobip] location pin without an order", {
                                conversationId: conversation.id,
                            });
                        }
                    } catch (error) {
                        console.error("[infobip] location record failed", error);
                    }
                }
            }
        }
    }

    return NextResponse.json({ received: inbound.length, stored: stored, reports: reports.length });
}
