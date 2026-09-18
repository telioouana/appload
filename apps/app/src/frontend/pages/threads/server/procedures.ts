import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { THREAD_SUBJECT } from "@workspace/db/types";

import {
    findThread,
    getThread,
    listMessages,
    listOrgThreads,
    markRead,
    unreadForUser,
    type OrgThreadRow,
    type ThreadMessageView,
    type ThreadUnread,
    type ThreadView,
} from "@workspace/domain/threads/queries";
import { sendMessage, ThreadMessageInputSchema } from "@workspace/domain/threads/send";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure } from "@workspace/trpc/tenant";

import { actorOf } from "@/frontend/pages/orders/server/projection";
import { withinRateLimit } from "@/lib/rate-limit";

/**
 * What a thread hangs off, as the portal names it: an Appload order (the
 * human order id) or one of the tenant's own loads (the movement id, either
 * end of a subcontract — `resolveThreadSubject` walks to the row that names
 * both companies).
 */
const SubjectSchema = z.object({
    subjectType: z.enum(THREAD_SUBJECT),
    subjectId: z.string().nonempty(),
});

const PageSchema = SubjectSchema.extend({
    before: z.date().optional(),
    limit: z.number().int().positive().max(100).optional(),
});

/** A conversation, not a broadcast: generous for a person, closed to a script. */
const SEND_WINDOW_MS = 60 * 60 * 1000;
const SEND_MAX = 60;

export const threadsRouter = createTRPCRouter({
    /** Opens the thread of a shipment this company is a party to. */
    get: authorizedTenantProcedure("thread", ["read"])
        .input(SubjectSchema)
        .query(({ ctx, input }): Promise<ThreadView> => getThread(ctx.db, actorOf(ctx.tenant), input)),

    messages: authorizedTenantProcedure("thread", ["read"])
        .input(PageSchema)
        .query(async ({ ctx, input }): Promise<ThreadMessageView[]> => {
            const threadId = await findThread(ctx.db, actorOf(ctx.tenant), input);

            if (!threadId) return [];

            return listMessages(ctx.db, threadId, { before: input.before, limit: input.limit });
        }),

    send: authorizedTenantProcedure("thread", ["send"])
        .input(ThreadMessageInputSchema.extend(SubjectSchema.shape))
        .mutation(async ({ ctx, input }) => {
            // Per person, not per company: one member's runaway client must
            // not silence their colleagues
            const allowed = await withinRateLimit(ctx.db, {
                key: `thread-send:user:${ctx.tenant.userId}`,
                windowMs: SEND_WINDOW_MS,
                max: SEND_MAX,
            });

            if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });

            return sendMessage(ctx.db, {
                actor: actorOf(ctx.tenant),
                subject: { subjectType: input.subjectType, subjectId: input.subjectId },
                body: input.body,
                attachments: input.attachments,
            });
        }),

    /** Moves this member's own cursor — never their company's. */
    markRead: authorizedTenantProcedure("thread", ["read"])
        .input(SubjectSchema)
        .mutation(async ({ ctx, input }): Promise<{ read: boolean }> => {
            const threadId = await findThread(ctx.db, actorOf(ctx.tenant), input);

            if (!threadId) return { read: false };

            await markRead(ctx.db, ctx.tenant.userId, threadId);

            return { read: true };
        }),

    /** Every conversation this company is in, for the Chats page. */
    list: authorizedTenantProcedure("thread", ["read"])
        .query(({ ctx }): Promise<OrgThreadRow[]> =>
            listOrgThreads(ctx.db, ctx.tenant.userId, ctx.tenant.organizationId)),

    /** The rail's message badge, counted for whoever is looking. */
    unread: authorizedTenantProcedure("thread", ["read"])
        .query(({ ctx }): Promise<ThreadUnread> => unreadForUser(ctx.db, actorOf(ctx.tenant))),
});
