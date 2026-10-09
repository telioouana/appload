import { and, eq, inArray, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movementEvent, movementRoute } from "@workspace/db/movements";
import { orderHistory } from "@workspace/db/orders";

import { progressFromRoute, type LatestPing, type MovementProgress } from "@workspace/domain/tracking/progress";

type Db = typeof Database;

/**
 * When each load left the loading site: its first move to on-route, off the
 * trail of status events. Loads still parked are absent from the map.
 */
export async function departures(db: Db, movementIds: string[]): Promise<Map<string, Date>> {
    if (movementIds.length === 0) return new Map();

    const rows = await db
        .select({
            movementId: movementEvent.movementId,
            at: sql`min(${movementEvent.createdAt})`.mapWith(movementEvent.createdAt),
        })
        .from(movementEvent)
        .where(and(inArray(movementEvent.movementId, movementIds), eq(movementEvent.kind, "status"), eq(movementEvent.toStatus, "on-route")))
        .groupBy(movementEvent.movementId);

    return new Map(rows.map((row) => [row.movementId, row.at]));
}

/** The same for Appload orders, off their history. */
export async function orderDepartures(db: Db, orderPks: string[]): Promise<Map<string, Date>> {
    if (orderPks.length === 0) return new Map();

    const rows = await db
        .select({
            orderId: orderHistory.orderId,
            at: sql`min(${orderHistory.createdAt})`.mapWith(orderHistory.createdAt),
        })
        .from(orderHistory)
        .where(and(inArray(orderHistory.orderId, orderPks), eq(orderHistory.toStatus, "on-route")))
        .groupBy(orderHistory.orderId);

    return new Map(rows.map((row) => [row.orderId, row.at]));
}

/**
 * One load's progress off its cached route and its latest position; null
 * when no route was ever cached for it (nothing to measure against).
 */
export async function readMovementProgress(db: Db, trailId: string, latest: LatestPing, dueAt: Date | null): Promise<MovementProgress | null> {
    const [route] = await db.select().from(movementRoute).where(eq(movementRoute.movementId, trailId)).limit(1);
    if (!route) return null;

    const departed = await departures(db, [trailId]);

    return progressFromRoute(route, latest, departed.get(trailId) ?? null, dueAt);
}
