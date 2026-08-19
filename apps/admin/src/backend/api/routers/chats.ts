import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";

import { chatConversation, chatMessage, type ChatConversation, type ChatMessage } from "@workspace/db/chats";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { StartChatBaseSchema } from "@/backend/schemas/start-chat";
import { sendWhatsAppText } from "@/lib/chats/infobip";
import { startConversation } from "@/lib/chats/conversations";

export type ConversationSummary = ChatConversation & {
    lastMessage: string | null;
};

export const chatsRouter = createTRPCRouter({
    list: authorizedProcedure("chat", ["list"]).query(async ({ ctx }): Promise<ConversationSummary[]> => {
        const conversations = await ctx.db
            .select()
            .from(chatConversation)
            .orderBy(desc(chatConversation.lastMessageAt));

        // Latest message per conversation for the list preview
        const previews = await ctx.db
            .selectDistinctOn([chatMessage.conversationId], {
                conversationId: chatMessage.conversationId,
                body: chatMessage.body,
            })
            .from(chatMessage)
            .orderBy(chatMessage.conversationId, desc(chatMessage.createdAt));

        const previewByConversation = new Map(previews.map((preview) => [preview.conversationId, preview.body]));

        return conversations.map((conversation) => ({
            ...conversation,
            lastMessage: previewByConversation.get(conversation.id) ?? null,
        }));
    }),

    messages: authorizedProcedure("chat", ["read"])
        .input(z.object({ conversationId: z.string() }))
        .query(async ({ ctx, input }): Promise<ChatMessage[]> => {
            return ctx.db
                .select()
                .from(chatMessage)
                .where(eq(chatMessage.conversationId, input.conversationId))
                .orderBy(asc(chatMessage.createdAt));
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

    start: authorizedProcedure("chat", ["start"])
        .input(StartChatBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ conversation: ChatConversation; existing: boolean }> => {
            return startConversation(ctx.db, input);
        }),
});
