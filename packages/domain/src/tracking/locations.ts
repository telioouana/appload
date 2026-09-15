/**
 * Where a driver's shared location becomes a tracking ping.
 *
 * Chats are keyed by phone number, orders by their own id, so every pin
 * has to be attributed before it can be stored. Both helpers are pure
 * data access — the webhook (and any future manual entry point) owns the
 * error handling, because a pin must never cost us the message.
 */

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { orderLocation } from "@workspace/db/tracking";
import type { db as Database } from "@workspace/db/db";
import { normalizePhone } from "@workspace/comms/phone";

import { ON_GOING_STATUSES } from "@workspace/domain/orders/status-groups";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

/**
 * The load a conversation's pin belongs to, as { id: uuid PK, orderId: human id }.
 *
 * Attribution, in order:
 *  1. the thread's linked order — chatConversation.orderId is the *human*
 *     id (APPL021.26), not the uuid, so it joins on order.orderId. An
 *     explicit link wins outright, including for a load that has already
 *     left the tracked set: a pin that arrives minutes after delivery
 *     still belongs to the trip the operator was watching.
 *  2. otherwise the driver's newest live booking — the same filter
 *     requestLocation uses (chats.ts): on-going orders only — wider than
 *     the cron's tracked set, because a driver who shares his position from
 *     the loading site is still telling us where the load is — and the
 *     phone match runs in JS because conversations store bare digits
 *     while orders keep E.164. A load that has actually departed outranks
 *     one still sitting at the loading site, and among equals the newest
 *     booking wins; a driver running two loads on the road at once is the
 *     one case this cannot disambiguate.
 *
 * Returns null when neither finds anything — an unknown sender, or a
 * driver with no live load.
 */
export async function resolveOrderForConversation(
    db: typeof Database,
    conversation: { orderId: string | null; driverPhone: string },
): Promise<{ id: string; orderId: string } | null> {
    if (conversation.orderId) {
        const [linked] = await db
            .select({ id: order.id, orderId: order.orderId })
            .from(order)
            .where(eq(order.orderId, conversation.orderId))
            .limit(1);

        // A dangling link (the order was purged) falls through to the
        // phone match rather than dropping the pin
        if (linked) {
            return linked;
        }
    }

    const candidates = await db
        .select({
            id: order.id,
            orderId: order.orderId,
            status: order.status,
            driverPhoneNumber: order.driverPhoneNumber,
        })
        .from(order)
        .where(and(
            inArray(order.status, ON_GOING_STATUSES),
            isNotNull(order.driverPhoneNumber),
        ))
        .orderBy(desc(order.createdAt));

    const mine = (row: { driverPhoneNumber: string | null }) =>
        normalizePhone(row.driverPhoneNumber!) === conversation.driverPhone;

    const active = candidates.find((row) => mine(row) && TRACKED_STATUSES.includes(row.status))
        ?? candidates.find(mine);

    return active ? { id: active.id, orderId: active.orderId } : null;
}

/**
 * Stores one ping. `orderId` is the order's uuid PK (what
 * resolveOrderForConversation returns as `id`), not the human id.
 *
 * Idempotent per chat message: the backfill replays old threads and a
 * re-run must not double the trail, so the insert conflicts away silently
 * on the unique chatMessageId and returns false — true means this call is
 * the one that actually created the trail point.
 *
 * That covers a replay of the *same* message row only. A retried webhook
 * arrives as a new row unless the caller recognizes it first, which is why
 * the Infobip route matches the inbound `externalId` before inserting
 * (app/api/chats/infobip/route.ts) — chat_message.external_id has no unique
 * constraint of its own.
 */
export async function recordOrderLocation(
    db: typeof Database,
    input: {
        orderId: string;
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
        .insert(orderLocation)
        .values({
            orderId: input.orderId,
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
        .returning({ id: orderLocation.id });

    return inserted.length > 0;
}
