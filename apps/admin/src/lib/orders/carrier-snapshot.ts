import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { order, type Order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";

// A trip only counts once the cargo arrived; everything earlier is still
// in flight and everything else never ran
const DONE: Order["status"][] = ["delivered", "completed"];

/**
 * The carrier's track record as of one moment: how long it has been with
 * Appload and how many trips it has finished. Every offer stores this pair
 * when it is written, so a decision taken two years ago still reads
 * against the numbers that were true when it was taken.
 *
 * `since` is the EARLIER of the organization row and the carrier's first
 * order: partners imported from the logbook carry the sync wall clock as
 * `created_at`, which would otherwise date a decade-old carrier to the day
 * we imported it.
 *
 * `before` (the backfill's use) counts only the trips that were already
 * done when the offer was made, keyed on the deal date because that is
 * when the trip was committed.
 */
export async function carrierSnapshot(
    db: typeof Database,
    carrierId: string,
    before?: Date,
): Promise<{ since: Date | null; trips: number }> {
    // ISO string rather than the Date: the timestamp columns are naive UTC
    // and Postgres casts "…Z" text to exactly that
    const counted = before === undefined
        ? inArray(order.status, DONE)
        : and(
            inArray(order.status, DONE),
            sql`coalesce(${order.dealDate}, ${order.createdAt}) < ${before.toISOString()}`,
        );

    const [[org], [orders]] = await Promise.all([
        db
            .select({ createdAt: organization.createdAt })
            .from(organization)
            .where(eq(organization.id, carrierId)),
        db
            .select({
                firstOrder: sql`min(${order.createdAt})`.mapWith(order.createdAt),
                trips: sql<number>`count(*) filter (where ${counted})`.mapWith(Number),
            })
            .from(order)
            .where(eq(order.carrierId, carrierId)),
    ]);

    // No organization row means nothing to date the relationship from: an
    // order can only point at a registered carrier (FK), so this is a
    // stale id, not a gap in the data
    const since = org === undefined ? null
        : orders?.firstOrder != null && orders.firstOrder < org.createdAt ? orders.firstOrder
            : org.createdAt;

    return { since, trips: orders?.trips ?? 0 };
}
