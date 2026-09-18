import "server-only";

import { and, asc, eq, exists, gt, inArray, isNull, lt, or } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { notificationCursor } from "@workspace/db/notifications";
import { order, orderHistory, type OrderHistory, type OrderHistoryKind } from "@workspace/db/orders";
import { user } from "@workspace/db/users";

import { notify, type NotifyInput } from "@workspace/domain/notifications";

// The trail kinds a partner hears about. An update, a note, a payment, a
// flag, a dispute or a system row is Appload's own bookkeeping on the order
// and would reach a company's inbox as noise.
const MATERIALIZED_KINDS: OrderHistoryKind[] = ["transition", "offer", "document"];

// A history row is written after the order row and outside its transaction,
// so one can land a moment after the cursor was already moved past its
// timestamp. The window is re-read on every pass; the (user, dedupeKey)
// unique index is what keeps a re-read from doubling anyone's inbox.
const LOOK_BACK_MS = 60_000;

// One pass is a poll's worth of work, never a backfill: a burst longer than
// this is picked up by the next poll seconds later.
const SCAN_LIMIT = 200;

/** One trail row as the materializer reads it, with the order's client. */
type TrailRow = {
    id: string;
    kind: OrderHistoryKind;
    // Straight off the column: the trail keeps the retired statuses the rows
    // were written with, and this only ever compares and renders them
    fromStatus: OrderHistory["fromStatus"];
    toStatus: OrderHistory["toStatus"];
    metadata: Record<string, unknown>;
    createdAt: Date;
    orderId: string;
    shipperId: string;
};

/** History metadata is free-form, so a display value is only used when it is one. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * What one trail row means to this organization, or null when it means
 * nothing to it. The trail is Appload's record of the order, so the same
 * event reads differently on each side: an offer is news to the shipper the
 * moment it is made, and nothing at all to the carrier that made it.
 */
function eventFor(row: TrailRow, organizationId: string): NotifyInput | null {
    const base = { organizationId, entityType: "order", entityId: row.orderId, dedupeKey: `history:${row.id}` };

    if (row.kind === "transition") {
        // Empty on the row an order is created with, which has no origin status
        const params = { orderId: row.orderId, from: row.fromStatus ?? "", to: row.toStatus ?? "" };

        // The two edges that decide whether a company has the load are worth
        // an email, and so is the delivery the shipper acts on; every other
        // step is read in the portal when it is read
        if (row.toStatus === "booked") return { ...base, kind: "order.booked", params, email: true };
        if (row.toStatus === "cancelled") return { ...base, kind: "order.cancelled", params, email: true };

        // The row an order is born with is not a move: staff opening an order
        // for a company put it on its list, and reading that as a status
        // change would announce a prospect as progress
        if (row.fromStatus === null) return null;

        return { ...base, kind: "order.status", params, email: row.toStatus === "delivered" };
    }

    if (row.kind === "document") {
        return {
            ...base,
            kind: "order.document",
            email: false,
            // `documentType`, not `type`: the portal's own document writer
            // names it that, and one ICU message renders both writers' rows
            params: { orderId: row.orderId, documentType: textOf(row.metadata.type) },
        };
    }

    if (organizationId === row.shipperId) {
        // A price on its cargo, whether or not it asked this carrier for one
        return textOf(row.metadata.action) === "created"
            ? { ...base, kind: "order.quoted", email: true, params: { orderId: row.orderId, carrierName: textOf(row.metadata.carrierName) } }
            : null;
    }

    // Nothing on the offer trail is the carrier's news: a carrier only
    // becomes a party to the order it won, so the offer rows it can see
    // belong to the carriers it beat. Winning itself is a transition to
    // booked, handled above.
    return null;
}

/**
 * Turns the order trail into notifications for one organization. The events
 * that reach a partner from outside the portal — Appload staff working the
 * order in Admin, a cron moving it — have no writer of their own, so they are
 * read from `order_history` and materialized here, by the unread-count poll
 * and by the outbox cron.
 *
 * Idempotent and re-entrant: every row carries `history:<id>` as its dedupe
 * key, so two passes racing over the same window still insert each event
 * once, and the cursor only ever moves forward.
 */
export async function materializeOrderEvents(
    db: typeof Database,
    organizationId: string,
    now?: Date,
): Promise<{ inserted: number; scanned: number }> {
    const [cursor] = await db
        .select({ lastHistoryCreatedAt: notificationCursor.lastHistoryCreatedAt })
        .from(notificationCursor)
        .where(eq(notificationCursor.organizationId, organizationId))
        .limit(1);

    // A company that joins today does not wake up to its history: with no
    // cursor the first pass only plants the mark the next one reads from
    if (!cursor) {
        await db
            .insert(notificationCursor)
            .values({ organizationId, lastHistoryCreatedAt: now ?? new Date() })
            .onConflictDoNothing();

        return { inserted: 0, scanned: 0 };
    }

    const rows: TrailRow[] = await db
        .select({
            id: orderHistory.id,
            kind: orderHistory.kind,
            fromStatus: orderHistory.fromStatus,
            toStatus: orderHistory.toStatus,
            metadata: orderHistory.metadata,
            createdAt: orderHistory.createdAt,
            orderId: order.orderId,
            shipperId: order.shipperId,
        })
        .from(orderHistory)
        .innerJoin(order, eq(order.id, orderHistory.orderId))
        .where(and(
            gt(orderHistory.createdAt, new Date(cursor.lastHistoryCreatedAt.getTime() - LOOK_BACK_MS)),
            inArray(orderHistory.kind, MATERIALIZED_KINDS),
            or(eq(order.shipperId, organizationId), eq(order.carrierId, organizationId)),
            // What reached the order from outside the portal, and only that:
            // Appload staff working it in the admin, or a cron or a webhook,
            // which leave no actor at all. Both parties write their own
            // notifications for each other, so materializing a partner's move
            // would put a second copy of it in the counterparty's inbox.
            or(
                isNull(orderHistory.actorUserId),
                exists(db
                    .select({ id: user.id })
                    .from(user)
                    .where(and(eq(user.id, orderHistory.actorUserId), eq(user.type, "appload")))),
            ),
        ))
        // Ascending, so the cursor can land on the last row of the page and
        // the next pass starts exactly where this one stopped
        .orderBy(asc(orderHistory.createdAt))
        .limit(SCAN_LIMIT);

    let inserted = 0;

    for (const row of rows) {
        const event = eventFor(row, organizationId);

        if (event) {
            inserted += await notify(db, event);
        }
    }

    const newest = rows.at(-1)?.createdAt;

    if (newest) {
        await db
            .update(notificationCursor)
            .set({ lastHistoryCreatedAt: newest })
            // The comparison is in the predicate, not in TypeScript: two polls
            // read the same cursor, and the slower one must not rewind the
            // position the faster one already advanced
            .where(and(
                eq(notificationCursor.organizationId, organizationId),
                lt(notificationCursor.lastHistoryCreatedAt, newest),
            ));
    }

    return { inserted, scanned: rows.length };
}
