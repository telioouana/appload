import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order } from "@workspace/db/orders";
import { chatConversation, type ChatConversation } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";
import { normalizePhone } from "@workspace/comms/phone";

import { TRACKED_STATUSES, type OrderStatus } from "@workspace/domain/tracking/statuses";

/** Statuses whose orders should always have an open driver thread. */
export const FOLLOW_UP_STATUSES: OrderStatus[] = ["booked", ...TRACKED_STATUSES];

/**
 * One conversation per driver phone, keyed by the normalized (bare-digit)
 * number so order-side E.164 ("+258…") and Infobip-side MSISDNs ("258…")
 * land in the same thread. Shared by chats.start, the order follow-up hooks
 * and the tracking cron so all of them create threads the exact same way.
 * When the thread already exists it is (re)linked to the given order — the
 * newest booking wins the link.
 */
export async function startConversation(
    db: typeof Database,
    params: { driverName: string; driverPhone: string; orderId?: string | null },
): Promise<{ conversation: ChatConversation; existing: boolean; relinked: boolean }> {
    const driverName = params.driverName.trim();
    const driverPhone = normalizePhone(params.driverPhone);
    const orderId = params.orderId?.trim() || null;

    if (!driverPhone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_PHONE" });
    }

    // The order link is a FK to "order".order_id — verify it first
    if (orderId) {
        const [linked] = await db
            .select({ orderId: order.orderId })
            .from(order)
            .where(eq(order.orderId, orderId))
            .limit(1);

        if (!linked) {
            throw new TRPCError({ code: "NOT_FOUND", message: "ORDER_NOT_FOUND" });
        }
    }

    const [existing] = await db
        .select()
        .from(chatConversation)
        .where(eq(chatConversation.driverPhone, driverPhone))
        .limit(1);

    if (existing) {
        const relink = orderId !== null && existing.orderId !== orderId;
        // Webhook-created threads are named after the number; a caller who
        // knows the real name heals the placeholder
        const rename = existing.driverName === existing.driverPhone
            && driverName !== ""
            && driverName !== existing.driverName;

        if (relink || rename) {
            const [updated] = await db
                .update(chatConversation)
                .set({
                    ...(relink ? { orderId } : {}),
                    ...(rename ? { driverName } : {}),
                })
                .where(eq(chatConversation.id, existing.id))
                .returning();

            return { conversation: updated ?? existing, existing: true, relinked: relink };
        }

        return { conversation: existing, existing: true, relinked: false };
    }

    const [conversation] = await db
        .insert(chatConversation)
        .values({ driverName, driverPhone, orderId })
        .returning();

    if (!conversation) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    }

    return { conversation, existing: false, relinked: false };
}
