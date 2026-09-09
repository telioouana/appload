import { z } from "zod";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order } from "@workspace/db/orders";
import { chatConversation } from "@workspace/db/chats";
import { orderLocation, orderRoute } from "@workspace/db/tracking";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import { computeOrderRoute } from "@workspace/maps/server/routes";
import { cacheKey, failedRecently, failureKey, GEOCODE_TTL_MS, num, rememberFailure, routeFailures, toRouteDto, trailSource } from "@workspace/maps/server/route-cache";
import type { MapOrder, OrderRouteDto, TrailPoint } from "@workspace/maps/types";

import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

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
