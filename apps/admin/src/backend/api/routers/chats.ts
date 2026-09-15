import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, countDistinct, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { order, orderHistory, type Order } from "@workspace/db/orders";
import { chatConversation, chatMessage, type ChatConversation, type ChatMessage } from "@workspace/db/chats";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import {
    locationRequestText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    sendWhatsAppText,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";
import { normalizePhone } from "@workspace/comms/phone";

import { StartChatBaseSchema } from "@/backend/schemas/start-chat";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { hasOpenSession, place, SESSION_WINDOW_HOURS } from "@workspace/domain/tracking/slot";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

export type ConversationSummary = ChatConversation & {
    lastMessage: string | null;
    orderStatus: Order["status"] | null;
    unreadCount: number;
    // Whether the driver's 24h WhatsApp session window is still open —
    // free text delivers directly; otherwise only templates get through
    sessionOpen: boolean;
};

/** One status transition of the conversation's linked order. */
export type ThreadStatusEvent = {
    id: string;
    // null = order creation
    fromStatus: Order["status"] | null;
    toStatus: Order["status"];
    createdAt: Date;
};

/**
 * The thread is messages interleaved with the linked order's status
 * transitions (read from orderHistory at query time, so past transitions
 * appear too), merged in chronological order.
 */
export type ThreadItem =
    | { kind: "message"; message: ChatMessage }
    | { kind: "status"; event: ThreadStatusEvent };

/**
 * Inbound messages newer than their conversation's read watermark — the
 * one definition the per-thread counts and the sidebar badge both read,
 * so the two can never disagree. Joins chatConversation.
 */
const unreadInbound = () => and(
    eq(chatMessage.direction, "inbound"),
    or(
        isNull(chatConversation.lastReadAt),
        gt(chatMessage.createdAt, chatConversation.lastReadAt),
    ),
);

export const chatsRouter = createTRPCRouter({
    list: authorizedProcedure("chat", ["list"]).query(async ({ ctx }): Promise<ConversationSummary[]> => {
        const [conversations, previews, unreadRows, lastInbound] = await Promise.all([
            ctx.db
                .select({ conversation: chatConversation, orderStatus: order.status })
                .from(chatConversation)
                // The conversation link is the human order id, not the uuid PK
                .leftJoin(order, eq(order.orderId, chatConversation.orderId))
                .orderBy(desc(chatConversation.lastMessageAt)),
            // Latest message per conversation for the list preview
            ctx.db
                .selectDistinctOn([chatMessage.conversationId], {
                    conversationId: chatMessage.conversationId,
                    body: chatMessage.body,
                })
                .from(chatMessage)
                .orderBy(chatMessage.conversationId, desc(chatMessage.createdAt)),
            // How many are waiting, per conversation
            ctx.db
                .select({ conversationId: chatMessage.conversationId, unread: count() })
                .from(chatMessage)
                .innerJoin(chatConversation, eq(chatConversation.id, chatMessage.conversationId))
                .where(unreadInbound())
                .groupBy(chatMessage.conversationId),
            // Latest inbound per conversation drives the session-window flag
            ctx.db
                .selectDistinctOn([chatMessage.conversationId], {
                    conversationId: chatMessage.conversationId,
                    createdAt: chatMessage.createdAt,
                })
                .from(chatMessage)
                .where(eq(chatMessage.direction, "inbound"))
                .orderBy(chatMessage.conversationId, desc(chatMessage.createdAt)),
        ]);

        const previewByConversation = new Map(previews.map((preview) => [preview.conversationId, preview.body]));
        const unreadByConversation = new Map(unreadRows.map((row) => [row.conversationId, row.unread]));
        const lastInboundByConversation = new Map(lastInbound.map((row) => [row.conversationId, row.createdAt]));
        const now = Date.now();

        return conversations.map(({ conversation, orderStatus }) => {
            const lastInboundAt = lastInboundByConversation.get(conversation.id);

            return {
                ...conversation,
                orderStatus,
                lastMessage: previewByConversation.get(conversation.id) ?? null,
                unreadCount: unreadByConversation.get(conversation.id) ?? 0,
                sessionOpen: lastInboundAt !== undefined
                    && now - lastInboundAt.getTime() < SESSION_WINDOW_HOURS * 3_600_000,
            };
        });
    }),

    /**
     * Threads waiting on a reply, for the sidebar badge: one per
     * conversation however many messages have stacked up inside it, so the
     * number names rows on the list it opens rather than messages.
     */
    unread: authorizedProcedure("chat", ["list"])
        .query(async ({ ctx }): Promise<number> => {
            const [row] = await ctx.db
                .select({ value: countDistinct(chatMessage.conversationId) })
                .from(chatMessage)
                .innerJoin(chatConversation, eq(chatConversation.id, chatMessage.conversationId))
                .where(unreadInbound());

            return row?.value ?? 0;
        }),

    markRead: authorizedProcedure("chat", ["read"])
        .input(z.object({ conversationId: z.string() }))
        .mutation(async ({ ctx, input }): Promise<void> => {
            await ctx.db
                .update(chatConversation)
                .set({ lastReadAt: new Date() })
                .where(eq(chatConversation.id, input.conversationId));
        }),

    orderSummary: authorizedProcedure("order", ["read"])
        // The human order id (e.g. "APPL021.26") — what conversations store
        .input(z.object({ orderId: z.string().min(1) }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select({
                    orderId: order.orderId,
                    status: order.status,
                    truckPlate: order.truckPlate,
                    driverName: order.driverName,
                    loadingAddress: order.loadingAddress,
                    offloadingAddress: order.offloadingAddress,
                    expectedLoadingDate: order.expectedLoadingDate,
                    expectedOffloadingDate: order.expectedOffloadingDate,
                })
                .from(order)
                .where(eq(order.orderId, input.orderId))
                .limit(1);

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            return row;
        }),

    messages: authorizedProcedure("chat", ["read"])
        .input(z.object({ conversationId: z.string() }))
        .query(async ({ ctx, input }): Promise<ThreadItem[]> => {
            const [messages, [conversation]] = await Promise.all([
                ctx.db
                    .select()
                    .from(chatMessage)
                    .where(eq(chatMessage.conversationId, input.conversationId))
                    .orderBy(asc(chatMessage.createdAt)),
                ctx.db
                    .select({ orderId: chatConversation.orderId })
                    .from(chatConversation)
                    .where(eq(chatConversation.id, input.conversationId))
                    .limit(1),
            ]);

            const items: ThreadItem[] = messages.map((message) => ({ kind: "message" as const, message }));

            if (!conversation?.orderId) {
                return items;
            }

            // orderHistory hangs off the uuid PK while the conversation link
            // is the human order id — bridge through the order table
            const events = await ctx.db
                .select({
                    id: orderHistory.id,
                    fromStatus: orderHistory.fromStatus,
                    toStatus: orderHistory.toStatus,
                    createdAt: orderHistory.createdAt,
                })
                .from(orderHistory)
                .innerJoin(order, eq(order.id, orderHistory.orderId))
                .where(and(
                    eq(order.orderId, conversation.orderId),
                    eq(orderHistory.kind, "transition"),
                    isNotNull(orderHistory.toStatus),
                ))
                .orderBy(asc(orderHistory.createdAt));

            for (const event of events) {
                items.push({ kind: "status", event: { ...event, toStatus: event.toStatus! } });
            }

            const at = (item: ThreadItem) =>
                item.kind === "message" ? item.message.createdAt : item.event.createdAt;

            return items.sort((a, b) => at(a).getTime() - at(b).getTime());
        }),

    send: authorizedProcedure("chat", ["send"])
        .input(z.object({ conversationId: z.string(), body: z.string().trim().min(1) }))
        .mutation(async ({ ctx, input }): Promise<ChatMessage> => {
            const [conversation] = await ctx.db
                .select()
                .from(chatConversation)
                .where(eq(chatConversation.id, input.conversationId))
                .limit(1);

            if (!conversation) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const result = await sendWhatsAppText(conversation.driverPhone, input.body);

            if (!result.ok) {
                console.error("Infobip send failed:", result.error);
            }

            // Store the message either way: failed sends stay visible with
            // their status so the operator can retry
            const [message] = await ctx.db
                .insert(chatMessage)
                .values({
                    conversationId: input.conversationId,
                    direction: "outbound",
                    body: input.body,
                    status: result.ok ? "sent" : "failed",
                    externalId: result.ok ? result.externalId : null,
                })
                .returning();

            if (!message) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            await ctx.db
                .update(chatConversation)
                .set({ lastMessageAt: message.createdAt })
                .where(eq(chatConversation.id, input.conversationId));

            if (!result.ok) {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "SEND_FAILED" });
            }

            return message;
        }),

    requestLocation: authorizedProcedure("chat", ["send"])
        .input(z.object({ conversationId: z.string().min(1) }))
        .mutation(async ({ ctx, input }): Promise<{ mode: "native" | "template"; message: ChatMessage }> => {
            const [conversation] = await ctx.db
                .select()
                .from(chatConversation)
                .where(eq(chatConversation.id, input.conversationId))
                .limit(1);

            if (!conversation) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            // The driver's current load: conversations store bare digits while
            // orders keep E.164, so the phone match normalizes in JS — the
            // tracked set is small. The thread's linked order wins over recency.
            const candidates = await ctx.db
                .select()
                .from(order)
                .where(and(
                    inArray(order.status, TRACKED_STATUSES),
                    isNotNull(order.driverPhoneNumber),
                ))
                .orderBy(desc(order.createdAt));

            const matches = candidates.filter(
                (row) => normalizePhone(row.driverPhoneNumber!) === conversation.driverPhone,
            );
            const active = matches.find((row) => row.orderId === conversation.orderId) ?? matches[0];

            if (!active) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NO_ACTIVE_ORDER" });
            }

            const driverName = active.driverName ?? conversation.driverName;
            const route = {
                truckPlate: active.truckPlate,
                origin: place(active.loadingAddress),
                destination: place(active.offloadingAddress),
            };

            // Same shortcut as the tracking cron: an open session window takes
            // the native location request (one tap for the driver); otherwise
            // the pre-approved template, whose button tap makes the webhook
            // send the native request.
            const open = await hasOpenSession(ctx.db, conversation.id);

            const body = open
                ? locationRequestText(active.orderId, route)
                : trackingTemplateText(driverName, active.orderId, active.truckPlate ?? "—", route.origin, route.destination);

            const result = open
                ? await sendWhatsAppLocationRequest(conversation.driverPhone, body)
                : await sendWhatsAppTemplate(
                    conversation.driverPhone,
                    [driverName, active.orderId, active.truckPlate ?? "—", route.origin, route.destination],
                    shareLocationPayload(active.orderId),
                );

            if (!result.ok) {
                console.error("Infobip location request failed:", result.error);
            }

            // Store the message either way: failed sends stay visible with
            // their status so the operator can retry
            const [message] = await ctx.db
                .insert(chatMessage)
                .values({
                    conversationId: conversation.id,
                    direction: "outbound",
                    body,
                    status: result.ok ? "sent" : "failed",
                    externalId: result.ok ? result.externalId : null,
                })
                .returning();

            if (!message) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            await ctx.db
                .update(chatConversation)
                .set({ lastMessageAt: message.createdAt })
                .where(eq(chatConversation.id, conversation.id));

            if (!result.ok) {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "SEND_FAILED" });
            }

            return { mode: open ? "native" : "template", message };
        }),

    start: authorizedProcedure("chat", ["start"])
        .input(StartChatBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ conversation: ChatConversation; existing: boolean; relinked: boolean }> => {
            return startConversation(ctx.db, input);
        }),
});
