import { z } from "zod";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, type Location } from "@workspace/db/orders";
import { chatConversation } from "@workspace/db/chats";
import { orderLocation, orderRoute } from "@workspace/db/tracking";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { computeOrderRoute } from "@/lib/maps/routes";
import { TRACKED_STATUSES } from "@/lib/tracking/statuses";
import type { MapOrder, OrderRouteDto, RouteSource, TrailPoint } from "@/frontend/pages/map/types";

/**
 * A geocode row is only the two endpoints — a poor answer we keep retrying
 * once a day in case the place id starts resolving. A `routes` row is the
 * real polyline and never expires: the addresses are part of the cache key,
 * so a re-route only happens when Ops edits one of them.
 */
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a failed compute is remembered. A failure has no geometry to
 * store, so it cannot be cached in `order_route` — and every retry costs one
 * Routes call plus two geocodes and holds the request open for up to three
 * eight-second timeouts. The order sheet embeds this map unconditionally, so
 * an order whose addresses do not resolve would otherwise pay for Google
 * again on every open, as fast as anyone can reopen it.
 */
const ROUTE_FAILURE_TTL_MS = 15 * 60 * 1000;

/** How many failures to remember before the expired ones are swept. */
const ROUTE_FAILURE_LIMIT = 200;

/**
 * Module scope, so the memory lives as long as the serverless instance: the
 * worst case is one paid attempt per cold start instead of one per open.
 * Keyed on the addresses too — editing them is exactly the event that makes
 * a retry worth paying for.
 */
const routeFailures = new Map<string, number>();

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

const num = (value: number | string): number => (typeof value === "number" ? value : Number(value));

const numOrNull = (value: number | string | null): number | null => (value === null ? null : num(value));

const routeSource = (value: string): RouteSource => (value === "geocode" ? "geocode" : "routes");

const trailSource = (value: string): TrailPoint["source"] => (value === "manual" ? "manual" : "whatsapp");

/**
 * What one endpoint was resolved against, and therefore what invalidates the
 * cached route. Orders imported from the logbook carry an empty place id and
 * are looked up by their address text (see `waypoint()` in lib/maps/routes),
 * so the text has to stand in as the key — keying on `""` would make every
 * such row look fresh forever and survive an address edit.
 */
const cacheKey = (location: Location): string => location.placeId || location.address;

/** The same pair the cached row is keyed on, plus the order it belongs to. */
const failureKey = (orderId: string, origin: Location, destination: Location): string =>
    `${orderId}\u0000${cacheKey(origin)}\u0000${cacheKey(destination)}`;

function failedRecently(key: string): boolean {
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

function rememberFailure(key: string): void {
    if (routeFailures.size >= ROUTE_FAILURE_LIMIT) {
        const now = Date.now();

        for (const [seen, at] of routeFailures) {
            if (now - at >= ROUTE_FAILURE_TTL_MS) routeFailures.delete(seen);
        }
    }

    routeFailures.set(key, Date.now());
}

/** `orderId` is the human id the caller asked for, not the row's uuid. */
function toRouteDto(orderId: string, row: RouteRow): OrderRouteDto {
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

export const mapRouter = createTRPCRouter({
    /**
     * The drawn route for one order, cached in `order_route`. Recomputed
     * when either endpoint changed or when a geocode-only answer has gone
     * stale; a compute failure falls back to whatever is cached rather than
     * blanking the map, and only an empty cache fails the query — and then
     * the failure itself is remembered for a quarter of an hour, so an order
     * Google cannot resolve is not re-bought on every sheet open.
     */
    route: authorizedProcedure("order", ["read"])
        .input(z.object({ orderId: z.string().min(1) }))
        .query(async ({ ctx, input }): Promise<OrderRouteDto> => {
            const [row] = await ctx.db
                .select({
                    id: order.id,
                    orderId: order.orderId,
                    loadingAddress: order.loadingAddress,
                    offloadingAddress: order.offloadingAddress,
                })
                .from(order)
                .where(eq(order.orderId, input.orderId))
                .limit(1);

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const [cached] = await ctx.db
                .select()
                .from(orderRoute)
                .where(eq(orderRoute.orderId, row.id))
                .limit(1);

            const fresh = cached
                && cached.originPlaceId === cacheKey(row.loadingAddress)
                && cached.destinationPlaceId === cacheKey(row.offloadingAddress)
                && (cached.source === "routes" || Date.now() - cached.computedAt.getTime() < GEOCODE_TTL_MS);

            if (cached && fresh) {
                return toRouteDto(row.orderId, cached);
            }

            const failure = failureKey(row.id, row.loadingAddress, row.offloadingAddress);

            // A compute that just failed for these addresses fails again for
            // free, so reopening the sheet costs a DB read instead of three
            // Google calls
            if (failedRecently(failure)) {
                if (cached) return toRouteDto(row.orderId, cached);

                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            const computed = await computeOrderRoute(row.loadingAddress, row.offloadingAddress);

            if (!computed) {
                rememberFailure(failure);

                // Google is unreachable or the addresses no longer resolve —
                // a stale line beats an empty map
                if (cached) return toRouteDto(row.orderId, cached);

                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            routeFailures.delete(failure);

            const values = {
                orderId: row.id,
                originPlaceId: cacheKey(row.loadingAddress),
                destinationPlaceId: cacheKey(row.offloadingAddress),
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

            const [saved] = await ctx.db
                .insert(orderRoute)
                .values(values)
                .onConflictDoUpdate({
                    target: orderRoute.orderId,
                    set: {
                        originPlaceId: values.originPlaceId,
                        destinationPlaceId: values.destinationPlaceId,
                        originLat: values.originLat,
                        originLng: values.originLng,
                        destinationLat: values.destinationLat,
                        destinationLng: values.destinationLng,
                        encodedPolyline: values.encodedPolyline,
                        distanceMeters: values.distanceMeters,
                        durationSeconds: values.durationSeconds,
                        source: values.source,
                        computedAt: values.computedAt,
                    },
                })
                .returning();

            if (!saved) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            return toRouteDto(row.orderId, saved);
        }),

    /** Every location ping recorded for one order, oldest first. */
    trail: authorizedProcedure("order", ["read"])
        .input(z.object({ orderId: z.string().min(1) }))
        .query(async ({ ctx, input }): Promise<TrailPoint[]> => {
            const [row] = await ctx.db
                .select({ id: order.id })
                .from(order)
                .where(eq(order.orderId, input.orderId))
                .limit(1);

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const points = await ctx.db
                .select({
                    id: orderLocation.id,
                    latitude: orderLocation.latitude,
                    longitude: orderLocation.longitude,
                    placeName: orderLocation.placeName,
                    recordedAt: orderLocation.recordedAt,
                    source: orderLocation.source,
                })
                .from(orderLocation)
                .where(eq(orderLocation.orderId, row.id))
                .orderBy(asc(orderLocation.recordedAt));

            return points.map((point) => ({
                id: point.id,
                lat: num(point.latitude),
                lng: num(point.longitude),
                placeName: point.placeName,
                recordedAt: point.recordedAt,
                source: trailSource(point.source),
            }));
        }),

    /**
     * Every truck currently on the road, with its latest ping — one query
     * per fact rather than a fan-out join, because the tracked set is small
     * and the client polls this on a timer.
     */
    overview: authorizedProcedure("order", ["list"]).query(async ({ ctx }): Promise<MapOrder[]> => {
        const orders = await ctx.db
            .select({
                id: order.id,
                orderId: order.orderId,
                status: order.status,
                shipperName: order.shipperName,
                carrierName: order.carrierName,
                driverName: order.driverName,
                driverPhoneNumber: order.driverPhoneNumber,
                truckPlate: order.truckPlate,
                loadingAddress: order.loadingAddress,
                offloadingAddress: order.offloadingAddress,
                expectedOffloadingDate: order.expectedOffloadingDate,
            })
            .from(order)
            .where(inArray(order.status, TRACKED_STATUSES))
            .orderBy(desc(order.createdAt));

        if (!orders.length) return [];

        const ids = orders.map((row) => row.id);
        const humanIds = orders.map((row) => row.orderId);

        const [lastPings, pingCounts, conversations] = await Promise.all([
            // Latest ping per order — same DISTINCT ON shape the chats list uses
            ctx.db
                .selectDistinctOn([orderLocation.orderId], {
                    id: orderLocation.id,
                    orderId: orderLocation.orderId,
                    latitude: orderLocation.latitude,
                    longitude: orderLocation.longitude,
                    placeName: orderLocation.placeName,
                    recordedAt: orderLocation.recordedAt,
                    source: orderLocation.source,
                })
                .from(orderLocation)
                .where(inArray(orderLocation.orderId, ids))
                .orderBy(orderLocation.orderId, desc(orderLocation.recordedAt)),
            ctx.db
                .select({ orderId: orderLocation.orderId, pings: count() })
                .from(orderLocation)
                .where(inArray(orderLocation.orderId, ids))
                .groupBy(orderLocation.orderId),
            // The conversation link is the human order id, not the uuid PK
            ctx.db
                .select({ id: chatConversation.id, orderId: chatConversation.orderId })
                .from(chatConversation)
                .where(inArray(chatConversation.orderId, humanIds))
                .orderBy(desc(chatConversation.lastMessageAt)),
        ]);

        const lastByOrder = new Map(lastPings.map((ping) => [ping.orderId, ping]));
        const countByOrder = new Map(pingCounts.map((row) => [row.orderId, row.pings]));
        const conversationByOrder = new Map<string, string>();

        // Newest thread first, so the first row seen for an order wins
        for (const conversation of conversations) {
            if (conversation.orderId && !conversationByOrder.has(conversation.orderId)) {
                conversationByOrder.set(conversation.orderId, conversation.id);
            }
        }

        return orders.map((row) => {
            const ping = lastByOrder.get(row.id);

            return {
                id: row.id,
                orderId: row.orderId,
                status: row.status,
                shipperName: row.shipperName,
                carrierName: row.carrierName,
                driverName: row.driverName,
                driverPhoneNumber: row.driverPhoneNumber,
                truckPlate: row.truckPlate,
                loadingAddress: row.loadingAddress,
                offloadingAddress: row.offloadingAddress,
                expectedOffloadingDate: row.expectedOffloadingDate,
                lastLocation: ping
                    ? {
                        id: ping.id,
                        lat: num(ping.latitude),
                        lng: num(ping.longitude),
                        placeName: ping.placeName,
                        recordedAt: ping.recordedAt,
                        source: trailSource(ping.source),
                    }
                    : null,
                pingCount: countByOrder.get(row.id) ?? 0,
                conversationId: conversationByOrder.get(row.orderId) ?? null,
            };
        });
    }),
});
