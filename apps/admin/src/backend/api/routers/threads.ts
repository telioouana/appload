import { z } from "zod";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import type { StaffActor } from "@workspace/domain/orders/actor";
import {
    findThread,
    getThread,
    listMessages,
    listStaffThreads,
    markRead,
    unreadForUser,
    type StaffThreadRow,
    type ThreadMessageView,
    type ThreadUnread,
    type ThreadView,
} from "@workspace/domain/threads/queries";
import { sendMessage, ThreadMessageInputSchema } from "@workspace/domain/threads/send";

/**
 * The order conversations, from Appload's side.
 *
 * Ops are a party to every order thread and to no portal load: a tenant's
 * books are their own, and `resolveThreadSubject` says so by giving a
 * movement `staff: false` — which is why a movement subject here comes back
 * as NOT_FOUND rather than needing a rule of its own. The input still only
 * admits "order", so the refusal is a second line, not the only one.
 */
const SubjectSchema = z.object({
    subjectType: z.literal("order"),
    subjectId: z.string().nonempty(),
});

/** One page of history, or the window before a given message. */
const PageSchema = SubjectSchema.extend({
    before: z.date().optional(),
    limit: z.number().int().positive().max(100).optional(),
});

export const threadsRouter = createTRPCRouter({
    /** Opens the thread of an order, creating it the first time it is looked at. */
    get: authorizedProcedure("chat", ["read"])
        .input(SubjectSchema)
        .query(({ ctx, input }): Promise<ThreadView> => getThread(ctx.db, actor(ctx.staff.role, ctx.session.user.id), input)),

    messages: authorizedProcedure("chat", ["read"])
        .input(PageSchema)
        .query(async ({ ctx, input }): Promise<ThreadMessageView[]> => {
            const threadId = await findThread(ctx.db, actor(ctx.staff.role, ctx.session.user.id), input);

            if (!threadId) return [];

            return listMessages(ctx.db, threadId, { before: input.before, limit: input.limit });
        }),

    send: authorizedProcedure("chat", ["send"])
        .input(ThreadMessageInputSchema.extend(SubjectSchema.shape))
        .mutation(({ ctx, input }) => sendMessage(ctx.db, {
            actor: actor(ctx.staff.role, ctx.session.user.id),
            subject: { subjectType: input.subjectType, subjectId: input.subjectId },
            body: input.body,
            attachments: input.attachments,
        })),

    /** Moves this reader's own cursor — never the whole Appload side's. */
    markRead: authorizedProcedure("chat", ["read"])
        .input(SubjectSchema)
        .mutation(async ({ ctx, input }): Promise<{ read: boolean }> => {
            const userId = ctx.session.user.id;
            const threadId = await findThread(ctx.db, actor(ctx.staff.role, userId), input);

            if (!threadId) return { read: false };

            await markRead(ctx.db, userId, threadId);

            return { read: true };
        }),

    /** The Messages badge, counted for whoever is looking. */
    unread: authorizedProcedure("chat", ["list"])
        .query(({ ctx }): Promise<ThreadUnread> => unreadForUser(ctx.db, actor(ctx.staff.role, ctx.session.user.id))),

    /** The "Order chats" side of the Messages page, newest first. */
    list: authorizedProcedure("chat", ["list"])
        .query(({ ctx }): Promise<StaffThreadRow[]> => listStaffThreads(ctx.db, ctx.session.user.id)),
});

const actor = (role: StaffActor["role"], userId: string): StaffActor => ({ kind: "staff", userId, role });
