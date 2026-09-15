import { z } from "zod";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, type Order } from "@workspace/db/orders";
import { orderLocation, orderRoute } from "@workspace/db/tracking";
import { movement, movementLocation } from "@workspace/db/movements";

import { movementRole } from "@workspace/domain/movements/policy";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";

import { computeOrderRoute } from "@workspace/maps/server/routes";
import { cacheKey, failedRecently, failureKey, GEOCODE_TTL_MS, num, rememberFailure, routeFailures, toRouteDto, trailSource } from "@workspace/maps/server/route-cache";
import type { OrderRouteDto, TrailPoint } from "@workspace/maps/types";

import { loadVisibleOrder, ownsOrder, scopeOf, type Db, type TenantScope } from "@/frontend/pages/orders/server/projection";
import { loadNames, loadTerminalRigs, onTheMap, toMovementRow, trailIds } from "@/frontend/pages/movements/server/projection";
import { movementTone } from "@/frontend/pages/movements/types";
import type { MapEntity } from "@/frontend/pages/map/types";

/** The map reads its own newest pings below; the row projection is only asked for names and the rig. */
const NO_PING_STATE = { last: new Map(), counts: new Map() };

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
    picked: ping.placeName !== null,
});

export const mapRouter = createTRPCRouter({
    /**
     * Everything of this tenant's that has a truck on it right now: the
     * Appload orders it is a party to in a tracked status, and its own loads
     * in progress — the ones it runs and the ones moved for it — each at its
     * latest known position.
     *
     * A load handed to a partner on the portal has no pings of its own: its
     * truck reports on the partner's row, so the pin is that row's newest
     * position, and the driver and plate come up with it — nothing else of
     * that row does.
     *
     * A handful of queries, never one per row: the two sets are read in
     * parallel and their newest pings looked up in one DISTINCT ON each,
     * because the client polls this on a timer.
     */
    overview: tenantProcedure.query(async ({ ctx }): Promise<MapEntity[]> => {
        const tenant = scopeOf(ctx.tenant);
        const shipper = tenant.orgType === "shipper";

        const [orders, loads] = await Promise.all([
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
                .select()
                .from(movement)
                .where(onTheMap(tenant.organizationId))
                .orderBy(desc(movement.startedAt)),
        ]);

        const orderIds = orders.map((row) => row.id);
        const trails = await trailIds(ctx.db, loads);
        const trailSubjects = [...new Set(trails.values())];
        const linkedTrails = loads.filter((row) => row.executionMovementId).map((row) => trails.get(row.id) ?? row.id);

        const [names, rigs] = await Promise.all([
            loadNames(ctx.db, loads.flatMap((row) => [row.organizationId, row.clientOrgId, row.carrierOrgId])),
            loadTerminalRigs(ctx.db, linkedTrails),
        ]);

        // Annotated rather than inferred: the empty-set branch and the query
        // branch are two different types, and a union of arrays has no `map`
        const [orderPings, loadPings]: [PingRow[], PingRow[]] = await Promise.all([
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
            trailSubjects.length
                ? ctx.db
                    .selectDistinctOn([movementLocation.movementId], {
                        subjectId: movementLocation.movementId,
                        id: movementLocation.id,
                        latitude: movementLocation.latitude,
                        longitude: movementLocation.longitude,
                        placeName: movementLocation.placeName,
                        recordedAt: movementLocation.recordedAt,
                        source: movementLocation.source,
                    })
                    .from(movementLocation)
                    .where(inArray(movementLocation.movementId, trailSubjects))
                    .orderBy(movementLocation.movementId, desc(movementLocation.recordedAt))
                : NO_PINGS,
        ]);

        const lastByOrder = new Map(orderPings.map((ping) => [ping.subjectId, ping]));
        const lastByTrail = new Map(loadPings.map((ping) => [ping.subjectId, ping]));

        const orderEntities: MapEntity[] = orders.map((row) => {
            const ping = lastByOrder.get(row.id);

            return {
                kind: "order",
                id: row.id,
                ref: row.orderId,
                href: { pathname: "/appload/details/[orderId]", params: { orderId: row.orderId } },
                counterpartyName: shipper ? row.carrierName : row.shipperName,
                status: row.status,
                origin: row.loadingAddress,
                destination: row.offloadingAddress,
                driverName: row.driverName,
                truckPlate: row.truckPlate,
                lastPosition: ping ? toPoint(ping) : null,
            };
        });

        const loadEntities: MapEntity[] = loads.map((row) => {
            // The predicate only admits rows the tenant owns or is the client of
            const role = movementRole(row, tenant.organizationId) ?? "client";
            const trailId = trails.get(row.id) ?? row.id;
            // Cut to what this company may know of the row, the way the lists cut it
            const view = toMovementRow(row, role, {
                names,
                pings: NO_PING_STATE,
                trailId,
                terminalRig: rigs.get(trailId) ?? null,
            });
            const ping = lastByTrail.get(trailId);
            const party = role === "owner" ? (row.execution === "partner" ? view.carrier : view.client) : view.owner;

            return {
                kind: "load",
                id: row.id,
                ref: view.ref,
                href: { pathname: "/orders/load/[loadId]", params: { loadId: row.id } },
                // Whoever else is on the load, from where the reader stands
                counterpartyName: party?.name ?? null,
                // The stage the truck is at, in the colour its chip is drawn in
                status: movementTone(row.status),
                origin: row.origin,
                destination: row.destination,
                driverName: view.driverName,
                truckPlate: view.truckPlate,
                lastPosition: ping ? toPoint(ping) : null,
            };
        });

        return [...orderEntities, ...loadEntities];
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
