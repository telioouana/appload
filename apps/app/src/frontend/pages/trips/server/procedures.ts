import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import { partnerConnection } from "@workspace/db/connections";
import { trip, tripLocation, tripRoute, tripTrackingRequest } from "@workspace/db/trips";
import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";

import {
    locationRequestText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";

import { notify } from "@workspace/domain/notifications";
import { assertTrackingAllowance, recordTrackingUsage } from "@workspace/domain/subscription";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { hasOpenSession, MAPUTO_OFFSET_MS, place } from "@workspace/domain/tracking/slot";

import { computeRoute } from "@workspace/maps/server/routes";
import {
    cacheKey,
    failedRecently,
    failureKey,
    GEOCODE_TTL_MS,
    num,
    rememberFailure,
    routeFailures,
    toRouteDto,
    trailSource,
} from "@workspace/maps/server/route-cache";
import type { OrderRouteDto, TrailPoint } from "@workspace/maps/types";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import { CreateTripBaseSchema, SetTripStatusBaseSchema, UpdateTripBaseSchema } from "@/backend/schemas/trip";
import {
    PAGE_SIZES,
    TRIP_SECTIONS,
    TRIP_SORTS,
    tripRef,
    type Location,
    type PagedResult,
    type SortDir,
    type TripDetail,
    type TripRow,
    type TripSection,
    type TripStats,
    type TripStatus,
} from "@/frontend/pages/trips/types";

type Db = typeof Database;

/** How many location requests the detail page shows. */
const REQUEST_HISTORY = 3;

/** Trips that are over: nothing on them may be edited or moved any more. */
const CLOSED_STATUSES: TripStatus[] = ["delivered", "cancelled"];

/**
 * The state machine, in full. Only the owner drives it: the counterparty is
 * told where the load is, it does not decide when it left or arrived.
 */
const NEXT_STATUS: Record<TripStatus, TripStatus[]> = {
    "scheduled": ["in-transit", "cancelled"],
    "in-transit": ["delivered", "cancelled"],
    "delivered": [],
    "cancelled": [],
};

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const countWhere = (predicate: SQL | undefined) =>
    predicate === undefined
        ? sql<number>`count(*)::int`.mapWith(Number)
        : sql<number>`count(*) filter (where ${predicate})::int`.mapWith(Number);

/**
 * Today's slot date in Maputo — the key the tracking cron writes its request
 * rows under, so "asked today" means exactly the rows it claimed.
 */
const slotDateToday = (now: Date) => new Date(now.getTime() + MAPUTO_OFFSET_MS).toISOString().slice(0, 10);

/** Midnight in Maputo as the UTC instant the pings are timestamped in. */
const startOfDay = (now: Date) => new Date(Date.parse(`${slotDateToday(now)}T00:00:00Z`) - MAPUTO_OFFSET_MS);

/**
 * Trips the driver was asked about today and has not answered: at least one
 * request left the building, and no position has come back since midnight.
 *
 * The conditions go in as drizzle expressions rather than as bare columns —
 * a `PgColumn` interpolated straight into a template loses its table prefix
 * when the outer query has no joins, which would bind `trip_id` to the
 * subquery's own table (the same reason `pendingOfferCount` is written this
 * way).
 */
const silentToday = (now: Date): SQL => and(
    sql`exists (
        select 1 from ${tripTrackingRequest} where ${and(
            eq(tripTrackingRequest.tripId, trip.id),
            eq(tripTrackingRequest.slotDate, slotDateToday(now)),
            inArray(tripTrackingRequest.status, ["sent", "delivered"]),
        )}
    )`,
    sql`not exists (
        select 1 from ${tripLocation} where ${and(
            eq(tripLocation.tripId, trip.id),
            gte(tripLocation.recordedAt, startOfDay(now)),
        )}
    )`,
) as SQL;

/**
 * Every trip this tenant is a side of. The predicate comes from the gate's
 * organization id and is composed into every read; a trip it is neither the
 * owner nor the named partner of does not exist as far as the portal is
 * concerned.
 */
const visibleTrips = (tenantId: string): SQL =>
    or(eq(trip.organizationId, tenantId), eq(trip.counterpartyOrgId, tenantId)) as SQL;

/** The section's own predicate, on top of the tenant one. */
const sectionScope = (section: TripSection): SQL | undefined => {
    switch (section) {
        case "scheduled": return eq(trip.status, "scheduled");
        case "in-transit": return eq(trip.status, "in-transit");
        case "delivered": return eq(trip.status, "delivered");
        // What never arrived; the loads that did have their own page
        case "history": return eq(trip.status, "cancelled");
        default: return undefined;
    }
};

/**
 * The join that turns a trip row into "the other company": the named partner
 * when the tenant owns the trip, the owner when it is the partner.
 */
const partnerJoin = (tenantId: string): SQL => sql`${organization.id} = case
    when ${trip.organizationId} = ${tenantId} then ${trip.counterpartyOrgId}
    else ${trip.organizationId}
end`;

const rowColumns = {
    id: trip.id,
    seq: trip.seq,
    status: trip.status,
    driverName: trip.driverName,
    driverPhone: trip.driverPhone,
    truckPlate: trip.truckPlate,
    origin: trip.origin,
    destination: trip.destination,
    startedAt: trip.startedAt,
    expectedDeliveryAt: trip.expectedDeliveryAt,
    deliveredAt: trip.deliveredAt,
    organizationId: trip.organizationId,
    counterpartyOrgId: trip.counterpartyOrgId,
    counterpartyName: organization.name,
    createdAt: trip.createdAt,
} as const;

/**
 * What `rowColumns` reads back. Spelled out rather than derived from the
 * columns: `counterpartyName` comes from a LEFT JOIN, so its nullability
 * belongs to the query and not to the column.
 */
type RowProjection = {
    id: string;
    seq: number;
    status: TripStatus;
    driverName: string;
    driverPhone: string;
    truckPlate: string | null;
    origin: Location;
    destination: Location;
    startedAt: Date | null;
    expectedDeliveryAt: Date | null;
    deliveredAt: Date | null;
    organizationId: string;
    counterpartyOrgId: string | null;
    counterpartyName: string | null;
    createdAt: Date;
};

/** The last ping and the ping count for a page of trips, keyed by trip. */
type PingState = {
    last: Map<string, TripRow["lastPing"]>;
    counts: Map<string, number>;
};

/**
 * Read as two flat queries rather than joined onto the list: a trail has as
 * many rows as the driver sent pins, and a join would multiply the trip.
 */
async function loadPings(db: Db, tripIds: string[]): Promise<PingState> {
    const [latest, counted] = await Promise.all([
        db
            .selectDistinctOn([tripLocation.tripId], {
                tripId: tripLocation.tripId,
                latitude: tripLocation.latitude,
                longitude: tripLocation.longitude,
                placeName: tripLocation.placeName,
                recordedAt: tripLocation.recordedAt,
            })
            .from(tripLocation)
            .where(inArray(tripLocation.tripId, tripIds))
            .orderBy(tripLocation.tripId, desc(tripLocation.recordedAt)),
        db
            .select({ tripId: tripLocation.tripId, pings: count() })
            .from(tripLocation)
            .where(inArray(tripLocation.tripId, tripIds))
            .groupBy(tripLocation.tripId),
    ]);

    return {
        last: new Map(latest.map((ping) => [ping.tripId, {
            recordedAt: ping.recordedAt,
            latitude: num(ping.latitude),
            longitude: num(ping.longitude),
            placeName: ping.placeName,
        }])),
        counts: new Map(counted.map((row) => [row.tripId, row.pings])),
    };
}

const toRow = (row: RowProjection, tenantId: string, pings: PingState): TripRow => ({
    id: row.id,
    ref: tripRef(row.seq),
    status: row.status,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    truckPlate: row.truckPlate,
    origin: row.origin,
    destination: row.destination,
    startedAt: row.startedAt,
    expectedDeliveryAt: row.expectedDeliveryAt,
    deliveredAt: row.deliveredAt,
    counterpartyName: row.counterpartyName,
    isMine: row.organizationId === tenantId,
    lastPing: pings.last.get(row.id) ?? null,
    pingCount: pings.counts.get(row.id) ?? 0,
});

/**
 * One trip the tenant may read, or a 404. Never a 403: telling a stranger
 * that a trip exists is already telling them something.
 */
async function loadVisibleTrip(db: Db, id: string, tenantId: string) {
    const [row] = await db
        .select()
        .from(trip)
        .where(and(eq(trip.id, id), visibleTrips(tenantId)))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/** The same, for the writes: only the owner tenant may change a trip. */
async function loadOwnTrip(db: Db, id: string, tenantId: string) {
    const [row] = await db
        .select()
        .from(trip)
        .where(and(eq(trip.id, id), eq(trip.organizationId, tenantId)))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/**
 * The connection that lets a tenant name a partner on its trip. Checked
 * server-side on every write: an organization id typed into a request is
 * never trusted, and a connection that ended closes the door again.
 */
async function assertConnectedPartner(db: Db, tenantId: string, partnerOrgId: string): Promise<void> {
    const [row] = await db
        .select({ id: partnerConnection.id })
        .from(partnerConnection)
        .where(and(
            eq(partnerConnection.status, "accepted"),
            or(
                and(eq(partnerConnection.requesterOrgId, tenantId), eq(partnerConnection.targetOrgId, partnerOrgId)),
                and(eq(partnerConnection.targetOrgId, tenantId), eq(partnerConnection.requesterOrgId, partnerOrgId)),
            ),
        ))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
    }
}

/** The tenant's own company name, as the notifications carry it. */
async function organizationName(db: Db, organizationId: string): Promise<string> {
    const [row] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

    return row?.name ?? "";
}

/** Tells the partner on the other side that the load moved, when there is one. */
async function notifyCounterparty(
    db: Db,
    params: { row: typeof trip.$inferSelect; kind: "trip.started" | "trip.delivered" },
): Promise<void> {
    const { row } = params;

    if (!row.counterpartyOrgId) return;

    await notify(db, {
        organizationId: row.counterpartyOrgId,
        kind: params.kind,
        email: false,
        entityType: "trip",
        entityId: row.id,
        params: {
            ref: tripRef(row.seq),
            organizationName: await organizationName(db, row.organizationId),
            origin: place(row.origin),
            destination: place(row.destination),
        },
    });
}

const TripsInput = z.object({
    section: z.enum(TRIP_SECTIONS).default("all"),
    search: z.string().trim().max(120).optional(),
    /** The tile: asked today and still silent */
    noResponse: z.literal(true).optional(),
    sort: z.enum(TRIP_SORTS).default("newest"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
});

type TripsInput = z.infer<typeof TripsInput>;

/** The reference, the driver and the plate are what a trip is looked up by. */
function searchWhere(term: string): SQL | undefined {
    const pattern = `%${escapeLike(term)}%`;
    const digits = term.replace(/\D/g, "");
    // "TRP-42", "trp 42" and "42" all mean the same row; anything longer than
    // a plausible sequence is a plate or a name, not a reference
    const seq = digits.length > 0 && digits.length <= 9 ? Number(digits) : null;

    return or(
        ilike(trip.driverName, pattern),
        ilike(trip.truckPlate, pattern),
        seq === null ? undefined : eq(trip.seq, seq),
    );
}

function ordering(sort: TripsInput["sort"], dir: SortDir): SQL[] {
    const by = (column: AnyColumn) =>
        dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;

    switch (sort) {
        case "started": return [by(trip.startedAt), desc(trip.seq)];
        case "expected": return [by(trip.expectedDeliveryAt), desc(trip.seq)];
        default: return [by(trip.createdAt), desc(trip.seq)];
    }
}

export const tripsRouter = createTRPCRouter({
    /**
     * One page of the section. Standalone trips only — a movement with an
     * order behind it is on the orders pages, and the map overview is where
     * the two kinds are seen together.
     */
    list: tenantProcedure
        .input(TripsInput)
        .query(async ({ ctx, input }): Promise<PagedResult<TripRow>> => {
            const tenantId = ctx.tenant.organizationId;

            const filters: (SQL | undefined)[] = [visibleTrips(tenantId), sectionScope(input.section)];

            if (input.search) filters.push(searchWhere(input.search));
            if (input.noResponse) filters.push(and(eq(trip.status, "in-transit"), silentToday(new Date())));

            const where = and(...filters);

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select(rowColumns)
                    .from(trip)
                    .leftJoin(organization, partnerJoin(tenantId))
                    .where(where)
                    .orderBy(...ordering(input.sort, input.dir))
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db
                    .select({ value: count() })
                    .from(trip)
                    .leftJoin(organization, partnerJoin(tenantId))
                    .where(where),
            ]);

            const pings: PingState = rows.length > 0
                ? await loadPings(ctx.db, rows.map((row) => row.id))
                : { last: new Map(), counts: new Map() };

            return {
                items: rows.map((row) => toRow(row, tenantId, pings)),
                total: counted?.value ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /**
     * The counts behind the section tabs and the attention tiles, in one
     * grouped scan of what the tenant may see — so a number always agrees
     * with the list its tile opens.
     */
    stats: tenantProcedure.query(async ({ ctx }): Promise<TripStats> => {
        const tenantId = ctx.tenant.organizationId;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const sectionSelect = Object.fromEntries(
            TRIP_SECTIONS.map((section) => [section, countWhere(sectionScope(section))]),
        ) as Record<TripSection, SQL<number>>;

        const [row] = await ctx.db
            .select({
                ...sectionSelect,
                total: count(),
                noResponseToday: countWhere(and(eq(trip.status, "in-transit"), silentToday(now))),
                deliveredThisMonth: countWhere(and(eq(trip.status, "delivered"), gte(trip.deliveredAt, monthStart))),
            })
            .from(trip)
            .where(visibleTrips(tenantId));

        const bySection = Object.fromEntries(
            TRIP_SECTIONS.map((section) => [section, Number(row?.[section] ?? 0)]),
        ) as Record<TripSection, number>;

        return {
            total: row?.total ?? 0,
            bySection,
            attention: {
                inTransit: bySection["in-transit"],
                noResponseToday: row?.noResponseToday ?? 0,
                scheduled: bySection.scheduled,
                delivered: bySection.delivered,
                deliveredThisMonth: row?.deliveredThisMonth ?? 0,
            },
        };
    }),

    /**
     * One trip in full: everything the row carries, plus the cargo and the
     * last few times we asked where the truck was. The panel reads its
     * buttons off `permissions` rather than re-deriving them, so what it
     * offers is exactly what the mutations accept.
     */
    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TripDetail> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadVisibleTrip(ctx.db, input.id, tenantId);
            // The other company: the named partner when the tenant owns the
            // trip, the owner when the tenant is the partner
            const partnerId = row.organizationId === tenantId ? row.counterpartyOrgId : row.organizationId;

            const [partner, pings, requests] = await Promise.all([
                partnerId === null
                    ? Promise.resolve(null)
                    : ctx.db
                        .select({ name: organization.name })
                        .from(organization)
                        .where(eq(organization.id, partnerId))
                        .limit(1)
                        .then((rows) => rows[0] ?? null),
                loadPings(ctx.db, [row.id]),
                ctx.db
                    .select({
                        id: tripTrackingRequest.id,
                        slotDate: tripTrackingRequest.slotDate,
                        slot: tripTrackingRequest.slot,
                        attempt: tripTrackingRequest.attempt,
                        channel: tripTrackingRequest.channel,
                        status: tripTrackingRequest.status,
                        createdAt: tripTrackingRequest.createdAt,
                    })
                    .from(tripTrackingRequest)
                    .where(eq(tripTrackingRequest.tripId, row.id))
                    .orderBy(desc(tripTrackingRequest.createdAt))
                    .limit(REQUEST_HISTORY),
            ]);

            const isMine = row.organizationId === tenantId;
            const open = !CLOSED_STATUSES.includes(row.status);

            return {
                ...toRow({ ...row, counterpartyName: partner?.name ?? null }, tenantId, pings),
                cargoDescription: row.cargoDescription,
                requests,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                permissions: {
                    isMine,
                    canStart: isMine && row.status === "scheduled",
                    canDeliver: isMine && row.status === "in-transit",
                    canCancel: isMine && open,
                    canRequestLocation: isMine && row.status === "in-transit",
                },
            };
        }),

    /**
     * Registers a movement to watch. "Already on the road" is what makes it
     * cost a tracked movement: the allowance is checked before the row is
     * written, and billed to the tenant right after it, so a refused trip
     * never leaves a half-started row behind.
     */
    create: authorizedTenantProcedure("trip", ["create"])
        .input(CreateTripBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string }> => {
            const tenantId = ctx.tenant.organizationId;

            if (input.counterpartyOrgId) {
                await assertConnectedPartner(ctx.db, tenantId, input.counterpartyOrgId);
            }

            if (input.startNow) {
                await assertTrackingAllowance(ctx.db, tenantId);
            }

            const [created] = await ctx.db
                .insert(trip)
                .values({
                    organizationId: tenantId,
                    counterpartyOrgId: input.counterpartyOrgId ?? null,
                    driverName: input.driverName,
                    driverPhone: input.driverPhone,
                    truckPlate: input.truckPlate?.trim() || null,
                    cargoDescription: input.cargoDescription?.trim() || null,
                    origin: input.origin,
                    destination: input.destination,
                    status: input.startNow ? "in-transit" : "scheduled",
                    startedAt: input.startNow ? new Date() : null,
                    expectedDeliveryAt: input.expectedDeliveryAt ?? null,
                    createdBy: ctx.tenant.userId,
                })
                .returning();

            if (!created) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            if (input.startNow) {
                await recordTrackingUsage(ctx.db, {
                    organizationIds: [tenantId],
                    entityType: "trip",
                    entityId: created.id,
                });

                await notifyCounterparty(ctx.db, { row: created, kind: "trip.started" });
            }

            return { id: created.id, ref: tripRef(created.seq) };
        }),

    /**
     * Corrects what the trip says while it is still running. A trip that is
     * over is a record of what happened, so nothing on it moves any more.
     */
    update: authorizedTenantProcedure("trip", ["update"])
        .input(UpdateTripBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwnTrip(ctx.db, input.id, tenantId);

            if (CLOSED_STATUSES.includes(row.status)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "TRIP_CLOSED" });
            }

            if (input.counterpartyOrgId) {
                await assertConnectedPartner(ctx.db, tenantId, input.counterpartyOrgId);
            }

            const values: Partial<typeof trip.$inferInsert> = {};

            if (input.driverName !== undefined) values.driverName = input.driverName;
            if (input.driverPhone !== undefined) values.driverPhone = input.driverPhone;
            if (input.origin !== undefined) values.origin = input.origin;
            if (input.destination !== undefined) values.destination = input.destination;
            if (input.truckPlate !== undefined) values.truckPlate = input.truckPlate.trim() || null;
            if (input.cargoDescription !== undefined) values.cargoDescription = input.cargoDescription.trim() || null;
            if (input.counterpartyOrgId !== undefined) values.counterpartyOrgId = input.counterpartyOrgId;
            if (input.expectedDeliveryAt !== undefined) values.expectedDeliveryAt = input.expectedDeliveryAt;

            if (Object.keys(values).length > 0) {
                await ctx.db
                    .update(trip)
                    .set(values)
                    .where(and(eq(trip.id, row.id), eq(trip.organizationId, tenantId)));
            }

            return { id: row.id };
        }),

    /**
     * The whole lifecycle, in one door. Starting a trip is what a plan pays
     * for, so it is gated and billed exactly like creating one that is
     * already on the road; delivering it closes tracking, because a truck
     * that arrived has nothing left to report.
     */
    setStatus: authorizedTenantProcedure("trip", ["update"])
        .input(SetTripStatusBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; status: TripStatus }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwnTrip(ctx.db, input.id, tenantId);

            if (!NEXT_STATUS[row.status].includes(input.to)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
            }

            if (input.to === "in-transit") {
                await assertTrackingAllowance(ctx.db, tenantId);
            }

            const [updated] = await ctx.db
                .update(trip)
                .set({
                    status: input.to,
                    ...(input.to === "in-transit" && { startedAt: new Date() }),
                    ...(input.to === "delivered" && { deliveredAt: new Date(), trackingEnabled: false }),
                })
                .where(and(eq(trip.id, row.id), eq(trip.organizationId, tenantId), eq(trip.status, row.status)))
                .returning();

            // The status moved between the read and the write: whoever got
            // there first decided, and this move is no longer a legal one
            if (!updated) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
            }

            if (input.to === "in-transit") {
                await recordTrackingUsage(ctx.db, {
                    organizationIds: [tenantId],
                    entityType: "trip",
                    entityId: updated.id,
                });

                await notifyCounterparty(ctx.db, { row: updated, kind: "trip.started" });
            }

            if (input.to === "delivered") {
                await notifyCounterparty(ctx.db, { row: updated, kind: "trip.delivered" });
            }

            return { id: updated.id, status: updated.status };
        }),

    /** Every position the driver reported for one trip, oldest first. */
    trail: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TrailPoint[]> => {
            const row = await loadVisibleTrip(ctx.db, input.id, ctx.tenant.organizationId);

            const points = await ctx.db
                .select({
                    id: tripLocation.id,
                    latitude: tripLocation.latitude,
                    longitude: tripLocation.longitude,
                    placeName: tripLocation.placeName,
                    recordedAt: tripLocation.recordedAt,
                    source: tripLocation.source,
                })
                .from(tripLocation)
                .where(eq(tripLocation.tripId, row.id))
                .orderBy(asc(tripLocation.recordedAt));

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
     * The drawn route for one trip, cached in `trip_route` under the same
     * rules as an order's: recomputed when either endpoint changed or when a
     * geocode-only answer has gone stale, a compute failure falls back to
     * whatever is cached rather than blanking the map, and only an empty
     * cache fails the query — with the failure itself remembered for a
     * quarter of an hour, so a trip Google cannot resolve is not re-bought
     * on every open.
     */
    route: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderRouteDto> => {
            const row = await loadVisibleTrip(ctx.db, input.id, ctx.tenant.organizationId);
            // The map contract names its subject `orderId`; a trip's own
            // reference is what goes in it, and nothing downstream reads it
            // as anything but a label
            const ref = tripRef(row.seq);

            const [cached] = await ctx.db
                .select()
                .from(tripRoute)
                .where(eq(tripRoute.tripId, row.id))
                .limit(1);

            const fresh = cached
                && cached.originPlaceId === cacheKey(row.origin)
                && cached.destinationPlaceId === cacheKey(row.destination)
                && (cached.source === "routes" || Date.now() - cached.computedAt.getTime() < GEOCODE_TTL_MS);

            if (cached && fresh) {
                return toRouteDto(ref, cached);
            }

            const failure = failureKey(row.id, row.origin, row.destination);

            if (failedRecently(failure)) {
                if (cached) return toRouteDto(ref, cached);

                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            const computed = await computeRoute(row.origin, row.destination);

            if (!computed) {
                rememberFailure(failure);

                if (cached) return toRouteDto(ref, cached);

                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            routeFailures.delete(failure);

            const values = {
                tripId: row.id,
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

            const [saved] = await ctx.db
                .insert(tripRoute)
                .values(values)
                .onConflictDoUpdate({
                    target: tripRoute.tripId,
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

            return toRouteDto(ref, saved);
        }),

    /**
     * Asks the driver where they are, now, outside the twice-daily rounds.
     *
     * Same shortcut the tracking cron takes: an open session window gets
     * WhatsApp's native location request (one tap for the driver), otherwise
     * the pre-approved template, whose button tap makes the webhook send the
     * native one. The message is stored either way, so a send that failed
     * stays visible in the thread instead of disappearing.
     */
    requestLocation: authorizedTenantProcedure("trip", ["update"])
        .input(z.object({ id: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ sent: boolean; mode: "native" | "template" }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwnTrip(ctx.db, input.id, tenantId);

            if (row.status !== "in-transit") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "TRIP_NOT_IN_TRANSIT" });
            }

            // No order id: chats point at orders, never at trips — the trip
            // holds the link instead, which is what keeps the import one-way
            const { conversation } = await startConversation(ctx.db, {
                driverName: row.driverName,
                driverPhone: row.driverPhone,
            });

            if (row.conversationId !== conversation.id) {
                await ctx.db
                    .update(trip)
                    .set({ conversationId: conversation.id })
                    .where(and(eq(trip.id, row.id), eq(trip.organizationId, tenantId)));
            }

            const ref = tripRef(row.seq);
            const origin = place(row.origin);
            const destination = place(row.destination);
            const open = await hasOpenSession(ctx.db, conversation.id);

            const body = open
                ? locationRequestText(ref, { truckPlate: row.truckPlate, origin, destination })
                : trackingTemplateText(row.driverName, ref, row.truckPlate ?? "—", origin, destination);

            const result = open
                ? await sendWhatsAppLocationRequest(conversation.driverPhone, body)
                : await sendWhatsAppTemplate(
                    conversation.driverPhone,
                    [row.driverName, ref, row.truckPlate ?? "—", origin, destination],
                    shareLocationPayload(ref),
                );

            if (!result.ok) {
                console.error("trip location request failed:", result.error);
            }

            const [message] = await ctx.db
                .insert(chatMessage)
                .values({
                    conversationId: conversation.id,
                    direction: "outbound",
                    body,
                    status: result.ok ? "sent" : "failed",
                    externalId: result.ok ? result.externalId : null,
                })
                .returning({ createdAt: chatMessage.createdAt });

            if (message) {
                await ctx.db
                    .update(chatConversation)
                    .set({ lastMessageAt: message.createdAt })
                    .where(eq(chatConversation.id, conversation.id));
            }

            // A provider that is not wired up is not a send worth retrying,
            // so it says so instead of reporting a silent failure
            if (!result.ok && result.error === "INFOBIP_NOT_CONFIGURED") {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "INFOBIP_NOT_CONFIGURED" });
            }

            return { sent: result.ok, mode: open ? "native" : "template" };
        }),
});
