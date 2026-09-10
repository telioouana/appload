import { z } from "zod";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";

import { order, type Order } from "@workspace/db/orders";
import { orderLocation, orderRoute } from "@workspace/db/tracking";
import { trip, tripLocation } from "@workspace/db/trips";
import { organization } from "@workspace/db/users";
import type { OrderStatus } from "@workspace/db/types";

import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";

import { computeOrderRoute } from "@workspace/maps/server/routes";
import { cacheKey, failedRecently, failureKey, GEOCODE_TTL_MS, num, rememberFailure, routeFailures, toRouteDto, trailSource } from "@workspace/maps/server/route-cache";
import type { OrderRouteDto, TrailPoint } from "@workspace/maps/types";

import { loadVisibleOrder, ownsOrder, scopeOf, type Db, type TenantScope } from "@/frontend/pages/orders/server/projection";
import type { MapEntity } from "@/frontend/pages/map/types";

/**
 * A standalone trip only reaches the map while it is in transit, which is
 * the same thing an order's "on-route" says — and the pin, the icon and the
 * badge are all keyed on the order vocabulary.
 */
const TRIP_PIN_STATUS: OrderStatus = "on-route";

/**
 * The order behind a map query, or NOT_FOUND. Seeing an order is not being a
 * party to it: a carrier that was asked about one, or quoted and lost it,
 * reads the row but not where the truck that won it is — the same line the
 * detail draws around the driver and the rig.
 */
async function loadOwnOrder(db: Db, orderId: string, tenant: TenantScope): Promise<Order> {
    const row = await loadVisibleOrder(db, orderId, tenant);

    if (!ownsOrder(row, tenant)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/** The ping columns both trails carry, named after the subject they belong to. */
type PingRow = {
    subjectId: string;
    id: string;
    latitude: number;
    longitude: number;
    placeName: string | null;
    recordedAt: Date;
    source: string;
};

const NO_PINGS: PingRow[] = [];

const toPoint = (ping: PingRow): TrailPoint => ({
    id: ping.id,
    lat: num(ping.latitude),
    lng: num(ping.longitude),
    placeName: ping.placeName,
    recordedAt: ping.recordedAt,
    source: trailSource(ping.source),
});

export const mapRouter = createTRPCRouter({
    /**
     * Everything of this tenant's that is on the road right now: the orders
     * it is a party to in a tracked status, and the standalone trips it owns
     * or is the counterparty on, each at its latest known position.
     *
     * Four queries, never one per row: the two sets are read in parallel and
     * their newest pings looked up in one DISTINCT ON each, because the
     * client polls this on a timer.
     */
    overview: tenantProcedure.query(async ({ ctx }): Promise<MapEntity[]> => {
        const tenant = scopeOf(ctx.tenant);
        const shipper = tenant.orgType === "shipper";

        // The trip's two sides are two rows of the same table; aliasing lets
        // one query name both without a second round trip
        const ownerOrg = alias(organization, "trip_owner_org");
        const partnerOrg = alias(organization, "trip_partner_org");

        const [orders, trips] = await Promise.all([
            ctx.db
                .select({
                    id: order.id,
                    orderId: order.orderId,
                    status: order.status,
                    shipperName: order.shipperName,
                    carrierName: order.carrierName,
                    driverName: order.driverName,
                    truckPlate: order.truckPlate,
                    loadingAddress: order.loadingAddress,
                    offloadingAddress: order.offloadingAddress,
                })
                .from(order)
                .where(and(
                    inArray(order.status, TRACKED_STATUSES),
                    // A tracked order is one somebody is driving, so the
                    // parties are the only readers: a carrier that merely
                    // quoted for it never sees the truck
                    or(eq(order.shipperId, tenant.organizationId), eq(order.carrierId, tenant.organizationId)),
                ))
                .orderBy(desc(order.createdAt)),
            ctx.db
                .select({
                    id: trip.id,
                    seq: trip.seq,
                    organizationId: trip.organizationId,
                    ownerName: ownerOrg.name,
                    partnerName: partnerOrg.name,
                    driverName: trip.driverName,
                    truckPlate: trip.truckPlate,
                    origin: trip.origin,
                    destination: trip.destination,
                })
                .from(trip)
                .leftJoin(ownerOrg, eq(ownerOrg.id, trip.organizationId))
                .leftJoin(partnerOrg, eq(partnerOrg.id, trip.counterpartyOrgId))
                .where(and(
                    eq(trip.status, "in-transit"),
                    or(
                        eq(trip.organizationId, tenant.organizationId),
                        eq(trip.counterpartyOrgId, tenant.organizationId),
                    ),
                ))
                .orderBy(desc(trip.startedAt)),
        ]);

        const orderIds = orders.map((row) => row.id);
        const tripIds = trips.map((row) => row.id);

        // Annotated rather than inferred: the empty-set branch and the query
        // branch are two different types, and a union of arrays has no `map`
        const [orderPings, tripPings]: [PingRow[], PingRow[]] = await Promise.all([
            orderIds.length
                ? ctx.db
                    .selectDistinctOn([orderLocation.orderId], {
                        subjectId: orderLocation.orderId,
                        id: orderLocation.id,
                        latitude: orderLocation.latitude,
                        longitude: orderLocation.longitude,
                        placeName: orderLocation.placeName,
                        recordedAt: orderLocation.recordedAt,
                        source: orderLocation.source,
                    })
                    .from(orderLocation)
                    .where(inArray(orderLocation.orderId, orderIds))
                    .orderBy(orderLocation.orderId, desc(orderLocation.recordedAt))
                : NO_PINGS,
            tripIds.length
                ? ctx.db
                    .selectDistinctOn([tripLocation.tripId], {
                        subjectId: tripLocation.tripId,
                        id: tripLocation.id,
                        latitude: tripLocation.latitude,
                        longitude: tripLocation.longitude,
                        placeName: tripLocation.placeName,
                        recordedAt: tripLocation.recordedAt,
                        source: tripLocation.source,
                    })
                    .from(tripLocation)
                    .where(inArray(tripLocation.tripId, tripIds))
                    .orderBy(tripLocation.tripId, desc(tripLocation.recordedAt))
                : NO_PINGS,
        ]);

        const lastByOrder = new Map(orderPings.map((ping) => [ping.subjectId, ping]));
        const lastByTrip = new Map(tripPings.map((ping) => [ping.subjectId, ping]));

        const orderEntities: MapEntity[] = orders.map((row) => {
            const ping = lastByOrder.get(row.id);

            return {
                kind: "order",
                id: row.id,
                ref: row.orderId,
                href: { pathname: "/orders/details/[orderId]", params: { orderId: row.orderId } },
                counterpartyName: shipper ? row.carrierName : row.shipperName,
                status: row.status,
                origin: row.loadingAddress,
                destination: row.offloadingAddress,
                driverName: row.driverName,
                truckPlate: row.truckPlate,
                lastPosition: ping ? toPoint(ping) : null,
            };
        });

        const tripEntities: MapEntity[] = trips.map((row) => {
            const ping = lastByTrip.get(row.id);

            return {
                kind: "trip",
                id: row.id,
                ref: `TRP-${row.seq}`,
                href: { pathname: "/trips/[tripId]", params: { tripId: row.id } },
                // Whichever side of the trip the reader is not on
                counterpartyName: row.organizationId === tenant.organizationId ? row.partnerName : row.ownerName,
                status: TRIP_PIN_STATUS,
                origin: row.origin,
                destination: row.destination,
                driverName: row.driverName,
                truckPlate: row.truckPlate,
                lastPosition: ping ? toPoint(ping) : null,
            };
        });

        return [...orderEntities, ...tripEntities];
    }),

    /**
     * The drawn route for one order, cached in `order_route` — the same row
     * and the same freshness rule Admin computes against, so a route bought
     * from Google on one side is never bought again on the other.
     *
     * Recomputed when either endpoint changed or when a geocode-only answer
     * has gone stale; a compute failure falls back to whatever is cached
     * rather than blanking the map, and only an empty cache fails the query —
     * and then the failure itself is remembered for a quarter of an hour, so
     * an order Google cannot resolve is not re-bought on every page open.
     */
    orderRoute: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderRouteDto> => {
            const row = await loadOwnOrder(ctx.db, input.orderId, scopeOf(ctx.tenant));

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

    /** Every location ping recorded for one of the tenant's orders, oldest first. */
    orderTrail: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TrailPoint[]> => {
            const row = await loadOwnOrder(ctx.db, input.orderId, scopeOf(ctx.tenant));

            const points = await ctx.db
                .select({
                    subjectId: orderLocation.orderId,
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

            return points.map(toPoint);
        }),
});
