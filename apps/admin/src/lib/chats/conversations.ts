import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order } from "@workspace/db/orders";
import { chatConversation, type ChatConversation } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";

/**
 * One conversation per driver phone. Shared by chats.start and the booked
 * transition's follow-up hook so both create threads the exact same way.
 * When the thread already exists it is (re)linked to the given order — the
 * newest booking wins the link.
 */
export async function startConversation(
    db: typeof Database,
    params: { driverName: string; driverPhone: string; orderId?: string | null },
): Promise<{ conversation: ChatConversation; existing: boolean }> {
    const driverName = params.driverName.trim();
    const driverPhone = params.driverPhone.trim();
    const orderId = params.orderId?.trim() || null;

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
        if (orderId && existing.orderId !== orderId) {
            const [relinked] = await db
                .update(chatConversation)
                .set({ orderId })
                .where(eq(chatConversation.id, existing.id))
                .returning();

            return { conversation: relinked ?? existing, existing: true };
        }

        return { conversation: existing, existing: true };
    }

    const [conversation] = await db
        .insert(chatConversation)
        .values({ driverName, driverPhone, orderId })
        .returning();

    if (!conversation) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    }

    return { conversation, existing: false };
}
