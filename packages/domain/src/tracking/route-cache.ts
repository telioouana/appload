import { eq } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movementRoute, type MovementRoute } from "@workspace/db/movements";
import type { Location } from "@workspace/db/orders";
import { cacheKey, failedRecently, failureKey, GEOCODE_TTL_MS, rememberFailure, routeFailures } from "@workspace/maps/server/route-cache";
import { computeRoute } from "@workspace/maps/server/routes";

type Db = typeof Database;

/**
 * The load's road in `movement_route`, computed when missing or stale — the
 * same freshness rules the order side keeps (route-cache.ts in maps): a
 * `routes` row lives until an address changes, a geocode-only row a day, a
 * failed compute is remembered a quarter of an hour so nobody pays Google
 * again for a lane it cannot resolve.
 *
 * Never throws: a lane Google cannot draw is a load without a map, not a
 * load that cannot be dispatched. Returns whatever is cached in that case,
 * stale or not, and null when there is nothing at all.
 */
export async function ensureMovementRoute(
    db: Db,
    row: { id: string; origin: Location; destination: Location },
): Promise<MovementRoute | null> {
    const [cached] = await db
        .select()
        .from(movementRoute)
        .where(eq(movementRoute.movementId, row.id))
        .limit(1);

    const fresh = cached
        && cached.originPlaceId === cacheKey(row.origin)
        && cached.destinationPlaceId === cacheKey(row.destination)
        && (cached.source === "routes" || Date.now() - cached.computedAt.getTime() < GEOCODE_TTL_MS);

    if (cached && fresh) return cached;

    const failure = failureKey(row.id, row.origin, row.destination);

    if (failedRecently(failure)) return cached ?? null;

    let computed: Awaited<ReturnType<typeof computeRoute>> = null;
    try {
        computed = await computeRoute(row.origin, row.destination);
    } catch {
        computed = null;
    }

    if (!computed) {
        rememberFailure(failure);
        return cached ?? null;
    }

    routeFailures.delete(failure);

    const values = {
        movementId: row.id,
        originPlaceId: cacheKey(row.origin),
        destinationPlaceId: cacheKey(row.destination),
        originLat: computed.origin.lat,
        originLng: computed.origin.lng,
        destinationLat: computed.destination.lat,
        destinationLng: computed.destination.lng,
        encodedPolyline: computed.encodedPolyline,
        distanceMeters: computed.distanceMeters,
        durationSeconds: computed.durationSeconds,
        source: computed.source,
        computedAt: new Date(),
    };

    const { movementId: _key, ...refresh } = values;

    const [saved] = await db
        .insert(movementRoute)
        .values(values)
        .onConflictDoUpdate({ target: movementRoute.movementId, set: refresh })
        .returning();

    return saved ?? cached ?? null;
}
