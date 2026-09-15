import type { Location } from "@workspace/db/orders";

import type { OrderRouteDto, RouteSource, TrailPoint } from "@workspace/maps/types";

/**
 * The freshness rules around `order_route`: what a cached row is keyed on,
 * how long a geocode-only answer is worth reusing, and the in-memory memory
 * of computes that just failed. Module scope, so it lives as long as the
 * serverless instance the procedures run on.
 */

/**
 * A geocode row is only the two endpoints — a poor answer we keep retrying
 * once a day in case the place id starts resolving. A `routes` row is the
 * real polyline and never expires: the addresses are part of the cache key,
 * so a re-route only happens when Ops edits one of them.
 */
export const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a failed compute is remembered. A failure has no geometry to
 * store, so it cannot be cached in `order_route` — and every retry costs one
 * Routes call plus two geocodes and holds the request open for up to three
 * eight-second timeouts. The order sheet embeds this map unconditionally, so
 * an order whose addresses do not resolve would otherwise pay for Google
 * again on every open, as fast as anyone can reopen it.
 */
export const ROUTE_FAILURE_TTL_MS = 15 * 60 * 1000;

/** How many failures to remember before the expired ones are swept. */
const ROUTE_FAILURE_LIMIT = 200;

/**
 * Module scope, so the memory lives as long as the serverless instance: the
 * worst case is one paid attempt per cold start instead of one per open.
 * Keyed on the addresses too — editing them is exactly the event that makes
 * a retry worth paying for.
 */
export const routeFailures = new Map<string, number>();

/**
 * Shape the procedures read out of `order_route`, kept structural so the
 * lat/lng columns work whether the schema stores them as doubles or as
 * `numeric` (which drizzle hands back as strings).
 */
type RouteRow = {
    originLat: number | string;
    originLng: number | string;
    destinationLat: number | string;
    destinationLng: number | string;
    encodedPolyline: string | null;
    distanceMeters: number | string | null;
    durationSeconds: number | string | null;
    source: string;
    computedAt: Date;
};

export const num = (value: number | string): number => (typeof value === "number" ? value : Number(value));

const numOrNull = (value: number | string | null): number | null => (value === null ? null : num(value));

const routeSource = (value: string): RouteSource => (value === "geocode" ? "geocode" : "routes");

export const trailSource = (value: string): TrailPoint["source"] => (value === "manual" ? "manual" : "whatsapp");

/**
 * What one endpoint was resolved against, and therefore what invalidates the
 * cached route. Orders imported from the logbook carry an empty place id and
 * are looked up by their address text (see `waypoint()` in lib/maps/routes),
 * so the text has to stand in as the key — keying on `""` would make every
 * such row look fresh forever and survive an address edit.
 */
export const cacheKey = (location: Location): string => location.placeId || location.address;

/** The same pair the cached row is keyed on, plus the order it belongs to. */
export const failureKey = (orderId: string, origin: Location, destination: Location): string =>
    `${orderId}\u0000${cacheKey(origin)}\u0000${cacheKey(destination)}`;

export function failedRecently(key: string): boolean {
    const at = routeFailures.get(key);

    if (at === undefined) {
        return false;
    }

    if (Date.now() - at < ROUTE_FAILURE_TTL_MS) {
        return true;
    }

    routeFailures.delete(key);

    return false;
}

export function rememberFailure(key: string): void {
    if (routeFailures.size >= ROUTE_FAILURE_LIMIT) {
        const now = Date.now();

        for (const [seen, at] of routeFailures) {
            if (now - at >= ROUTE_FAILURE_TTL_MS) routeFailures.delete(seen);
        }
    }

    routeFailures.set(key, Date.now());
}

/** `orderId` is the human id the caller asked for, not the row's uuid. */
export function toRouteDto(orderId: string, row: RouteRow): OrderRouteDto {
    return {
        orderId,
        origin: { lat: num(row.originLat), lng: num(row.originLng) },
        destination: { lat: num(row.destinationLat), lng: num(row.destinationLng) },
        encodedPolyline: row.encodedPolyline,
        distanceMeters: numOrNull(row.distanceMeters),
        durationSeconds: numOrNull(row.durationSeconds),
        source: routeSource(row.source),
        computedAt: row.computedAt,
    };
}
