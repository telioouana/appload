import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { order } from "@workspace/db/orders";
import { user } from "@workspace/db/users";
import { kycDocument } from "@workspace/db/kyc-documents";
import { FLEET_STATUS, KYC_STATUS, LoadingBaySchema, OWNERSHIP_STATUS, TRUCK_TYPE } from "@workspace/db/types";
import type { KycStatus, KycSubjectType, LoadingBay, OwnershipStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";
import type { OrgAction } from "@workspace/auth/organization-permissions";

import { docProgress, today, type CurrentDoc } from "@workspace/domain/kyc/derive";

import { uniqueViolationConstraint } from "@workspace/db/errors";
import {
    RegisterLinkBaseSchema,
    RegisterTrailerBaseSchema,
    RegisterTruckBaseSchema,
    VEHICLE_KIND,
    VIN_PATTERN,
} from "@/backend/schemas/register-fleet";
import {
    ISSUE_STATUSES,
    STATUS_FILTERS,
    VEHICLE_SORTS,
    type FleetStatus,
    type PagedResult,
    type StatusCounts,
    type StatusFilter,
    type VehicleKind,
    type VehicleProfile,
    type VehicleRow,
    type VehicleStats,
} from "@/frontend/pages/fleet/types";

type Db = typeof Database;

/**
 * A vehicle as a picker offers it. Year and loading bay travel with it so a
 * form can derive truck age and bay capacity the moment one is chosen, and
 * the two verdicts so an unverified or third-party-owned vehicle is visible
 * while it is being picked rather than after the order is booked.
 */
export type VehicleOption = {
    id: string;
    regPlate: string;
    year: number | null;
    loadingBay: LoadingBay | null;
    kycStatus: KycStatus;
    ownershipStatus: OwnershipStatus;
};

const VEHICLE_TABLE = { truck, trailer, link } as const;

const vehicleKind = z.enum(VEHICLE_KIND);

/**
 * Fleet writes need the role statement and nothing else. Any company may
 * keep a fleet: a carrier's is what it sells, a shipper's moves its own goods
 * between its own sites. The rows are scoped to the tenant either way, which
 * is what actually protects them.
 */
const fleetProcedure = (actions: OrgAction<"fleet">[]) => authorizedTenantProcedure("fleet", actions);

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// Plates are stored masked ("AAA 000 MC"); match ignoring case and spacing
// so "aaa000" finds them
const normalizePlateQuery = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizePlate = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

const PageInput = {
    search: z.string().trim().max(120).optional(),
    status: z.enum(STATUS_FILTERS).optional(),
    state: z.enum(FLEET_STATUS).optional(),
    unassigned: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
    dir: z.enum(["asc", "desc"]).default("asc"),
};

const VehiclesInput = z.object({
    ...PageInput,
    kind: vehicleKind,
    sort: z.enum(VEHICLE_SORTS).optional(),
    ownership: z.enum(OWNERSHIP_STATUS).optional(),
});

type VehiclesInput = z.infer<typeof VehiclesInput>;

const VehiclePatch = z.object({
    regPlate: z.string().trim().nonempty().optional(),
    internalId: z.string().trim().max(60).nullable().optional(),
    brand: z.string().trim().nonempty().optional(),
    model: z.string().trim().nonempty().optional(),
    year: z.number().int().min(1950).max(2100).optional(),
    vin: z.string().trim().regex(VIN_PATTERN).optional(),
    type: z.enum(TRUCK_TYPE).optional(),
    loadingBay: LoadingBaySchema.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const fleetRouter = createTRPCRouter({
    vehicles: createTRPCRouter({
        /** One page of the tenant's own trucks, trailers or links. */
        list: tenantProcedure
            .input(VehiclesInput)
            .query(async ({ ctx, input }): Promise<PagedResult<VehicleRow>> => {
                const page = input.page ?? 1;
                const { items, total } = await listVehicles(
                    ctx.db,
                    ctx.tenant.organizationId,
                    input,
                    input.pageSize,
                    (page - 1) * input.pageSize,
                );

                return { items, total, page, pageSize: input.pageSize };
            }),

        /** The counts behind the status tabs and the attention tiles. */
        stats: tenantProcedure
            .input(z.object({ kind: vehicleKind }))
            .query(async ({ ctx, input }): Promise<VehicleStats> => {
                const table = VEHICLE_TABLE[input.kind];
                const carrier = eq(table.carrierId, ctx.tenant.organizationId);

                const [row] = await ctx.db
                    .select({
                        total: count(),
                        draft: statusCount(table.kycStatus, "draft"),
                        "pending-review": statusCount(table.kycStatus, "pending-review"),
                        verified: statusCount(table.kycStatus, "verified"),
                        rejected: statusCount(table.kycStatus, "rejected"),
                        expired: statusCount(table.kycStatus, "expired"),
                        suspended: statusCount(table.kycStatus, "suspended"),
                        active: conditionCount(eq(table.status, "active")),
                        idle: conditionCount(eq(table.status, "idle")),
                        free: conditionCount(eq(table.status, "free")),
                        ownership: conditionCount(eq(table.ownershipStatus, "unverified")),
                        unassigned: conditionCount(unassignedVehicle(ctx.db, input.kind, ctx.tenant.organizationId)),
                    })
                    .from(table)
                    .where(carrier);

                const byStatus = Object.fromEntries(
                    KYC_STATUS.map((status) => [status, row?.[status] ?? 0]),
                ) as StatusCounts;

                return {
                    total: row?.total ?? 0,
                    byStatus,
                    issues: ISSUE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
                    byState: {
                        active: row?.active ?? 0,
                        idle: row?.idle ?? 0,
                        free: row?.free ?? 0,
                    },
                    attention: {
                        ownership: row?.ownership ?? 0,
                        unassigned: row?.unassigned ?? 0,
                    },
                };
            }),

        /** Everything the profile panel shows for one vehicle. */
        get: tenantProcedure
            .input(z.object({ kind: vehicleKind, id: z.string().nonempty() }))
            .query(async ({ ctx, input }): Promise<VehicleProfile> => {
                const table = VEHICLE_TABLE[input.kind];

                const [row] = await ctx.db
                    .select({
                        id: table.id,
                        regPlate: table.regPlate,
                        internalId: table.internalId,
                        brand: table.brand,
                        model: table.model,
                        year: table.year,
                        vin: table.vin,
                        loadingBay: table.loadingBay,
                        status: table.status,
                        kycStatus: table.kycStatus,
                        ownershipStatus: table.ownershipStatus,
                        ownerName: table.ownerName,
                        ownerNuit: table.ownerNuit,
                        createdAt: table.createdAt,
                        truckType: input.kind === "truck" ? truck.type : sql<null>`null`,
                    })
                    .from(table)
                    // The id from input is only ever combined with the tenant
                    // predicate, so another carrier's plate is a 404 here
                    .where(and(eq(table.id, input.id), eq(table.carrierId, ctx.tenant.organizationId)));

                if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                const [documents, drivers, hitchedTo] = await Promise.all([
                    currentDocuments(ctx.db, input.kind, row.id),
                    input.kind !== "truck" ? [] : ctx.db
                        .select({ id: driver.id, name: user.name, kycStatus: driver.kycStatus })
                        .from(driver)
                        .innerJoin(user, eq(user.id, driver.userId))
                        .where(and(eq(driver.truckId, row.id), eq(driver.carrierId, ctx.tenant.organizationId)))
                        .orderBy(asc(user.name)),
                    hitchedPlate(ctx.db, input.kind, ctx.tenant.organizationId, row.id),
                ]);

                const bay = row.loadingBay as LoadingBay | null;

                return {
                    ...row,
                    kind: input.kind,
                    loadingBay: bay,
                    capacity: bay?.capacity ?? null,
                    bayType: bay?.type ?? null,
                    progress: docProgress(input.kind, documents, today()),
                    drivers,
                    hitchedTo,
                };
            }),

        /**
         * Type-ahead over the tenant's vehicles of one kind, for the pickers.
         * The carrier is the signed-in tenant, so — unlike Admin — there is no
         * carrier to pass and none to get wrong.
         */
        search: tenantProcedure
            .input(z.object({ kind: vehicleKind, query: z.string() }))
            .query(async ({ ctx, input }): Promise<VehicleOption[]> => {
                const table = VEHICLE_TABLE[input.kind];
                const normalized = normalizePlateQuery(input.query);

                const filters = [eq(table.carrierId, ctx.tenant.organizationId)];

                if (normalized) {
                    filters.push(
                        sql`replace(lower(${table.regPlate}), ' ', '') LIKE ${`%${escapeLike(normalized)}%`}`,
                    );
                }

                const rows = await ctx.db
                    .select({
                        id: table.id,
                        regPlate: table.regPlate,
                        year: table.year,
                        loadingBay: table.loadingBay,
                        kycStatus: table.kycStatus,
                        ownershipStatus: table.ownershipStatus,
                    })
                    .from(table)
                    .where(and(...filters))
                    .orderBy(asc(table.regPlate))
                    .limit(10);

                return rows;
            }),

        /** Registers a truck, trailer or link into the tenant's own fleet. */
        register: fleetProcedure(["create"])
            .input(z.discriminatedUnion("kind", [
                RegisterTruckBaseSchema.extend({ kind: z.literal("truck") }),
                RegisterTrailerBaseSchema.extend({ kind: z.literal("trailer") }),
                RegisterLinkBaseSchema.extend({ kind: z.literal("link") }),
            ]))
            .mutation(async ({ ctx, input }): Promise<VehicleOption> => {
                const carrierId = ctx.tenant.organizationId;

                const shared = {
                    carrierId,
                    regPlate: normalizePlate(input.regPlate),
                    internalId: input.internalId || null,
                    brand: input.brand,
                    model: input.model,
                    year: input.year,
                    vin: input.vin.toUpperCase(),
                };

                try {
                    if (input.kind === "truck") {
                        return await insertVehicle(ctx.db, "truck", {
                            ...shared,
                            type: input.type,
                            // An articulated truck tows the bay on its trailer
                            loadingBay: input.type === "non-articulated" ? (input.loadingBay ?? null) : null,
                        });
                    }

                    return await insertVehicle(ctx.db, input.kind, {
                        ...shared,
                        loadingBay: input.loadingBay,
                    });
                } catch (error) {
                    if (error instanceof TRPCError) throw error;

                    return await mapVehicleUniqueViolation(ctx.db, carrierId, input.kind, shared, error);
                }
            }),

        /** Partial edit of one of the tenant's vehicles. */
        update: fleetProcedure(["update"])
            .input(z.object({ kind: vehicleKind, id: z.string().nonempty(), patch: VehiclePatch }))
            .mutation(async ({ ctx, input }): Promise<{ id: string; regPlate: string }> => {
                const table = VEHICLE_TABLE[input.kind];
                const carrierId = ctx.tenant.organizationId;
                const { patch } = input;

                const [current] = await ctx.db
                    .select({ id: table.id, regPlate: table.regPlate })
                    .from(table)
                    .where(and(eq(table.id, input.id), eq(table.carrierId, carrierId)));

                if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                // Trailers and links carry the bay themselves; the column is NOT NULL
                if (input.kind !== "truck" && patch.loadingBay === null) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "BAY_REQUIRED" });
                }

                const values: Record<string, unknown> = {};
                if (patch.internalId !== undefined) values.internalId = patch.internalId || null;
                if (patch.brand !== undefined) values.brand = patch.brand;
                if (patch.model !== undefined) values.model = patch.model;
                if (patch.year !== undefined) values.year = patch.year;
                if (patch.vin !== undefined) values.vin = patch.vin.toUpperCase();
                if (patch.loadingBay !== undefined) values.loadingBay = patch.loadingBay;
                if (input.kind === "truck" && patch.type !== undefined) {
                    values.type = patch.type;
                    // An articulated truck tows the bay on its trailer
                    if (patch.type === "articulated") values.loadingBay = null;
                }

                if (patch.regPlate !== undefined) {
                    const next = normalizePlate(patch.regPlate);

                    if (next !== current.regPlate) {
                        // Orders reference the plate itself, not the vehicle row:
                        // renaming one that has already travelled would rewrite
                        // history (and break the FK), so it is refused outright
                        if (await plateInUse(ctx.db, input.kind, current.regPlate)) {
                            throw new TRPCError({ code: "CONFLICT", message: "PLATE_LOCKED" });
                        }
                        values.regPlate = next;
                    }
                }

                if (Object.keys(values).length === 0) return current;

                try {
                    const [updated] = await ctx.db
                        .update(table)
                        .set(values)
                        .where(and(eq(table.id, input.id), eq(table.carrierId, carrierId)))
                        .returning({ id: table.id, regPlate: table.regPlate });

                    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                    return updated;
                } catch (error) {
                    if (error instanceof TRPCError) throw error;

                    return await mapVehicleUniqueViolation(
                        ctx.db,
                        carrierId,
                        input.kind,
                        { regPlate: values.regPlate, vin: values.vin },
                        error,
                    );
                }
            }),
    }),

    /** Sets, moves or clears a driver's home truck. Both rows must be ours. */
    assignDriver: fleetProcedure(["update"])
        .input(z.object({ driverId: z.string().nonempty(), truckId: z.string().nonempty().nullable() }))
        .mutation(async ({ ctx, input }): Promise<{ id: string; truckId: string | null }> => {
            const carrierId = ctx.tenant.organizationId;

            const [current] = await ctx.db
                .select({ id: driver.id })
                .from(driver)
                .where(and(eq(driver.id, input.driverId), eq(driver.carrierId, carrierId)));

            if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            if (input.truckId) {
                const [home] = await ctx.db
                    .select({ id: truck.id })
                    .from(truck)
                    .where(and(eq(truck.id, input.truckId), eq(truck.carrierId, carrierId)));

                if (!home) throw new TRPCError({ code: "NOT_FOUND", message: "TRUCK_NOT_FOUND" });
            }

            await ctx.db
                .update(driver)
                .set({ truckId: input.truckId })
                .where(and(eq(driver.id, input.driverId), eq(driver.carrierId, carrierId)));

            return { id: input.driverId, truckId: input.truckId };
        }),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const direction = (dir: "asc" | "desc") => (dir === "desc" ? desc : asc);

const statusCount = (column: AnyColumn, status: KycStatus) =>
    sql<number>`count(*) filter (where ${column} = ${status})`.mapWith(Number);

const conditionCount = (condition: SQL) =>
    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

const statusCondition = (column: AnyColumn, status: StatusFilter) =>
    status === "issues" ? inArray(column, ISSUE_STATUSES) : eq(column, status);

/** Trucks nobody drives; trailers and links hitched to nothing. */
function unassignedVehicle(db: Db, kind: VehicleKind, carrierId: string): SQL {
    if (kind === "truck") {
        return notInArray(
            truck.id,
            db.select({ id: driver.truckId })
                .from(driver)
                .where(and(eq(driver.carrierId, carrierId), sql`${driver.truckId} is not null`)),
        );
    }
    if (kind === "trailer") return isNull(trailer.truckId);
    return isNull(link.trailerId);
}

function vehicleConditions(db: Db, carrierId: string, input: VehiclesInput): SQL {
    const table = VEHICLE_TABLE[input.kind];
    // Always first, and never overridable from input: this is the tenant gate
    const conditions: SQL[] = [eq(table.carrierId, carrierId)];

    if (input.status) conditions.push(statusCondition(table.kycStatus, input.status));
    if (input.state) conditions.push(eq(table.status, input.state));
    if (input.ownership) conditions.push(eq(table.ownershipStatus, input.ownership));
    if (input.unassigned) conditions.push(unassignedVehicle(db, input.kind, carrierId));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        // Both sides normalized the same way, so a plate stored as
        // "SD-752069247" is still found by typing "SD752069247"
        const plate = `%${escapeLike(normalizePlateQuery(input.search))}%`;

        conditions.push(or(
            sql`regexp_replace(lower(${table.regPlate}), '[^a-z0-9]', '', 'g') like ${plate}`,
            ilike(table.brand, term),
            ilike(table.model, term),
            ilike(table.vin, term),
        )!);
    }

    return and(...conditions)!;
}

function vehicleOrder(input: VehiclesInput): SQL[] {
    const table = VEHICLE_TABLE[input.kind];
    const dir = direction(input.dir);

    switch (input.sort) {
        case "status":
            return [dir(table.kycStatus), asc(table.regPlate)];
        case "year":
            return [dir(table.year), asc(table.regPlate)];
        case "created":
            return [dir(table.createdAt), asc(table.regPlate)];
        default:
            return [dir(table.regPlate)];
    }
}

async function listVehicles(db: Db, carrierId: string, input: VehiclesInput, limit: number, offset: number) {
    const table = VEHICLE_TABLE[input.kind];
    const where = vehicleConditions(db, carrierId, input);

    const [rows, [total]] = await Promise.all([
        db
            .select({
                id: table.id,
                regPlate: table.regPlate,
                internalId: table.internalId,
                brand: table.brand,
                model: table.model,
                year: table.year,
                loadingBay: table.loadingBay,
                status: table.status,
                kycStatus: table.kycStatus,
                ownershipStatus: table.ownershipStatus,
                ownerName: table.ownerName,
                truckType: input.kind === "truck" ? truck.type : sql<null>`null`,
            })
            .from(table)
            .where(where)
            .orderBy(...vehicleOrder(input))
            .limit(limit)
            .offset(offset),

        db.select({ value: count() }).from(table).where(where),
    ]);

    const ids = rows.map((row) => row.id);

    const [docs, standing, hitched] = await Promise.all([
        documentsBySubject(db, input.kind, ids),

        // The standing assignment: the driver whose home truck this is
        input.kind !== "truck" || ids.length === 0 ? [] : db
            .select({ truckId: driver.truckId, driverId: driver.id, driverName: user.name })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(and(eq(driver.carrierId, carrierId), inArray(driver.truckId, ids))),

        hitchedPlates(db, input.kind, carrierId, ids),
    ]);

    const byTruck = new Map(standing.map((row) => [row.truckId, row]));
    const on = today();

    const items: VehicleRow[] = rows.map((row) => {
        const bay = row.loadingBay as LoadingBay | null;
        const home = byTruck.get(row.id);

        return {
            id: row.id,
            kind: input.kind,
            regPlate: row.regPlate,
            internalId: row.internalId,
            brand: row.brand,
            model: row.model,
            year: row.year,
            truckType: row.truckType,
            capacity: bay?.capacity ?? null,
            bayType: bay?.type ?? null,
            status: row.status as FleetStatus,
            kycStatus: row.kycStatus,
            ownershipStatus: row.ownershipStatus,
            ownerName: row.ownerName,
            progress: docProgress(input.kind, docs.get(row.id) ?? [], on),
            driverId: home?.driverId ?? null,
            driverName: home?.driverName ?? null,
            hitchedTo: hitched.get(row.id) ?? null,
        };
    });

    return { items, total: total?.value ?? 0 };
}

/**
 * The plate of whatever a towed unit is hitched to, for a page of rows. The
 * tenant predicate is on the joined side too: a plate is the only thing this
 * projects, and it must still be one of the tenant's own.
 */
async function hitchedPlates(
    db: Db,
    kind: VehicleKind,
    carrierId: string,
    ids: string[],
): Promise<Map<string, string>> {
    const byId = new Map<string, string>();

    if (kind === "truck" || ids.length === 0) return byId;

    if (kind === "trailer") {
        const rows = await db
            .select({ id: trailer.id, plate: truck.regPlate })
            .from(trailer)
            .innerJoin(truck, and(eq(truck.id, trailer.truckId), eq(truck.carrierId, carrierId)))
            .where(inArray(trailer.id, ids));

        for (const row of rows) byId.set(row.id, row.plate);
        return byId;
    }

    const rows = await db
        .select({ id: link.id, plate: trailer.regPlate })
        .from(link)
        .innerJoin(trailer, and(eq(trailer.id, link.trailerId), eq(trailer.carrierId, carrierId)))
        .where(inArray(link.id, ids));

    for (const row of rows) byId.set(row.id, row.plate);
    return byId;
}

const hitchedPlate = async (db: Db, kind: VehicleKind, carrierId: string, id: string) =>
    (await hitchedPlates(db, kind, carrierId, [id])).get(id) ?? null;

/**
 * The live document set for a batch of subjects, keyed by subject id. One
 * query for the whole page rather than one per row; superseded and
 * soft-deleted rows are filtered in code, mirroring the Admin KYC reads.
 */
export async function documentsBySubject(
    db: Db,
    subjectType: KycSubjectType,
    ids: string[],
): Promise<Map<string, CurrentDoc[]>> {
    const byId = new Map<string, CurrentDoc[]>();

    if (ids.length === 0) return byId;

    const rows = await db
        .select({
            id: kycDocument.id,
            subjectId: kycDocument.subjectId,
            type: kycDocument.type,
            status: kycDocument.status,
            expiresAt: kycDocument.expiresAt,
            supersedesId: kycDocument.supersedesId,
        })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, subjectType),
            inArray(kycDocument.subjectId, ids),
            isNull(kycDocument.deletedAt),
        ))
        .orderBy(desc(kycDocument.createdAt));

    const superseded = new Set(
        rows.map((row) => row.supersedesId).filter((id): id is string => id !== null),
    );

    const seen = new Map<string, Set<string>>();

    for (const row of rows) {
        if (superseded.has(row.id)) continue;

        const types = seen.get(row.subjectId) ?? new Set<string>();
        if (types.has(row.type)) continue;
        types.add(row.type);
        seen.set(row.subjectId, types);

        byId.set(row.subjectId, [
            ...(byId.get(row.subjectId) ?? []),
            { type: row.type, status: row.status, expiresAt: row.expiresAt },
        ]);
    }

    return byId;
}

/** The same set for a single subject — what the profile panel lists. */
export const currentDocuments = async (db: Db, subjectType: KycSubjectType, id: string) =>
    (await documentsBySubject(db, subjectType, [id])).get(id) ?? [];

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Whether any order already carries this plate in the column for its kind. */
async function plateInUse(db: Db, kind: VehicleKind, plate: string): Promise<boolean> {
    const column =
        kind === "truck" ? order.truckPlate :
            kind === "trailer" ? order.trailerPlate :
                order.linkPlate;

    const [row] = await db.select({ value: count() }).from(order).where(eq(column, plate));

    return (row?.value ?? 0) > 0;
}

/** Whether the row a plate or VIN collided with is one of the tenant's own. */
async function heldByTenant(
    db: Db,
    kind: VehicleKind,
    column: "regPlate" | "vin",
    value: string,
    carrierId: string,
): Promise<boolean> {
    const table = VEHICLE_TABLE[kind];

    const [row] = await db
        .select({ carrierId: table.carrierId })
        .from(table)
        .where(eq(table[column], value))
        .limit(1);

    return row?.carrierId === carrierId;
}

/**
 * Plates and VINs are unique platform-wide, so a collision can just as well
 * be with a vehicle in another carrier's fleet — one this tenant is owed
 * nothing about. Its own fleet gets the code that says where to look; anybody
 * else's collapses to "unavailable", which says the value cannot be
 * registered here and nothing about who holds it.
 */
async function mapVehicleUniqueViolation(
    db: Db,
    carrierId: string,
    kind: VehicleKind,
    attempted: { regPlate?: unknown; vin?: unknown },
    error: unknown,
): Promise<never> {
    const constraint = uniqueViolationConstraint(error);

    if (constraint === null) {
        throw error;
    }
    if (constraint.includes("reg_plate")) {
        const plate = typeof attempted.regPlate === "string" ? attempted.regPlate : null;
        const own = plate !== null && await heldByTenant(db, kind, "regPlate", plate, carrierId);

        throw new TRPCError({ code: "CONFLICT", message: own ? "DUPLICATE_PLATE" : "PLATE_UNAVAILABLE" });
    }
    if (constraint.includes("vin")) {
        const vin = typeof attempted.vin === "string" ? attempted.vin : null;
        const own = vin !== null && await heldByTenant(db, kind, "vin", vin, carrierId);

        throw new TRPCError({ code: "CONFLICT", message: own ? "DUPLICATE_VIN" : "VIN_UNAVAILABLE" });
    }

    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
}

async function insertVehicle(
    db: Db,
    kind: VehicleKind,
    values: Record<string, unknown>,
): Promise<VehicleOption> {
    const table = VEHICLE_TABLE[kind];

    const [created] = await db
        .insert(table)
        .values(values as never)
        .returning({
            id: table.id,
            regPlate: table.regPlate,
            year: table.year,
            loadingBay: table.loadingBay,
            kycStatus: table.kycStatus,
            ownershipStatus: table.ownershipStatus,
        });

    if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    }

    return created;
}
