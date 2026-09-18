import "server-only";

import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";

import { notification, NOTIFICATION_KIND } from "@workspace/db/notifications";

import { materializeOrderEvents } from "@workspace/domain/notifications/materialize";

import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";

import {
    DEFAULT_PAGE_SIZE,
    PAGE_SIZES,
    type NotificationRow,
    type PagedResult,
} from "@/frontend/pages/notifications/types";

/** How many rows one click may mark at a time — a page of the longest list. */
const MARK_READ_LIMIT = 100;

const NotificationsInput = z.object({
    unreadOnly: z.boolean().optional(),
    kind: z.enum(NOTIFICATION_KIND).optional(),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(DEFAULT_PAGE_SIZE),
});

const rowColumns = {
    id: notification.id,
    kind: notification.kind,
    params: notification.params,
    entityType: notification.entityType,
    entityId: notification.entityId,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
};

export const notificationsRouter = createTRPCRouter({
    /**
     * One page of this member's own notifications, newest first.
     *
     * The scope is the reader and their organization, never anything from
     * the input: a row is one person's copy of an event, and a member who
     * moves company keeps reading only what happened where they are now.
     */
    list: tenantProcedure
        .input(NotificationsInput)
        .query(async ({ ctx, input }): Promise<PagedResult<NotificationRow>> => {
            const where = mine(ctx.tenant.userId, ctx.tenant.organizationId, [
                input.unreadOnly ? isNull(notification.readAt) : undefined,
                input.kind ? eq(notification.kind, input.kind) : undefined,
            ]);

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select(rowColumns)
                    .from(notification)
                    .where(where)
                    .orderBy(desc(notification.createdAt))
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db
                    .select({ value: count() })
                    .from(notification)
                    .where(where),
            ]);

            return {
                items: rows,
                total: counted?.value ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /**
     * The badge's number — and the portal's one heartbeat.
     *
     * Reading the order trail happens here because this is the query that
     * already runs every thirty seconds for whoever is looking: an order
     * moved by Appload staff in the admin has no writer of its own, and this
     * turns it into notifications before the count is taken. The cron does
     * the same for the organizations nobody is looking at.
     */
    unreadCount: tenantProcedure.query(async ({ ctx }): Promise<{ count: number; alerts: number }> => {
        try {
            await materializeOrderEvents(ctx.db, ctx.tenant.organizationId);
        } catch (error) {
            // The trail is a bonus on top of what the portal wrote itself:
            // failing to read it must never cost the reader their badge
            console.error(`notification materialization failed for ${ctx.tenant.organizationId}`, error);
        }

        // The location alerts are counted apart: a driver gone quiet is the
        // one notification that wants to be seen before the rest, so the bell
        // and the rail can mark it differently.
        //
        // What the parties said is the Chats badge's, not the bell's: the row
        // is still written and still listed, but counting it here would put
        // one message behind two numbers that clear on two different actions
        const [row] = await ctx.db
            .select({
                value: count(),
                alerts: count(sql`case when ${notification.kind} = 'movement.location-alert' then 1 end`),
            })
            .from(notification)
            .where(mine(ctx.tenant.userId, ctx.tenant.organizationId, [
                isNull(notification.readAt),
                ne(notification.kind, "thread.message"),
            ]));

        return { count: row?.value ?? 0, alerts: row?.alerts ?? 0 };
    }),

    /** Marks what the reader just opened, or the rows a popover showed them. */
    markRead: tenantProcedure
        .input(z.object({ ids: z.array(z.string()).min(1).max(MARK_READ_LIMIT) }))
        .mutation(async ({ ctx, input }): Promise<{ read: number }> => {
            const rows = await ctx.db
                .update(notification)
                .set({ readAt: new Date() })
                .where(mine(ctx.tenant.userId, ctx.tenant.organizationId, [
                    inArray(notification.id, input.ids),
                    // Only the unread ones, so a second click cannot move a
                    // timestamp that already says when it was read
                    isNull(notification.readAt),
                ]))
                .returning({ id: notification.id });

            return { read: rows.length };
        }),

    /** Clears the inbox in one go; the filters on screen do not narrow it. */
    markAllRead: tenantProcedure.mutation(async ({ ctx }): Promise<{ read: number }> => {
        const rows = await ctx.db
            .update(notification)
            .set({ readAt: new Date() })
            .where(mine(ctx.tenant.userId, ctx.tenant.organizationId, [isNull(notification.readAt)]))
            .returning({ id: notification.id });

        return { read: rows.length };
    }),
});

/** The reader's own rows in their own organization, plus whatever narrows them. */
function mine(userId: string, organizationId: string, filters: (SQL | undefined)[]): SQL | undefined {
    return and(
        eq(notification.userId, userId),
        eq(notification.organizationId, organizationId),
        ...filters,
    );
}
