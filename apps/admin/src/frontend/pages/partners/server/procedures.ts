import { z } from "zod";
import { and, asc, count, countDistinct, desc, eq, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { organization, user } from "@workspace/db/users";
import { order, type Location } from "@workspace/db/orders";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { kycDocument } from "@workspace/db/kyc-documents";
import { KYC_STATUS, type KycSubjectType, type LoadingBay } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types";
import { addDays, docProgress, today, type CurrentDoc } from "@/lib/kyc/derive";
import { CONTRACT_DOC, subjectKind } from "@/lib/kyc/requirements";
import { EXPIRY_WINDOW_DAYS } from "@/frontend/pages/partners/types";
import type { ContractState, DriverRow, OrgRow, StatsBucket, VehicleRow } from "@/frontend/pages/partners/types";

type Db = typeof Database;

const kycStatus = z.enum(KYC_STATUS);
const vehicleKind = z.enum(["truck", "trailer", "link"]);

const VEHICLE_TABLE = { truck, trailer, link } as const;

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const PageInput = {
    search: z.string().trim().max(120).optional(),
    status: kycStatus.optional(),
    // Days-until-expiry window; set by the expiring stat card
    expiring: z.coerce.number().int().positive().max(365).optional(),
    // Cursor is the 1-based page index, same contract as orders.list
    cursor: z.number().int().min(1).nullish(),
    limit: z.number().int().min(1).max(100).default(20),
};

/** City label for a jsonb Location, falling back to its full address. */
const city = (location: Location | null | undefined) =>
    location?.state || location?.country || location?.address || null;

/**
 * The live document set for a batch of subjects, keyed by subject id.
 * One query for the whole page rather than one per row: superseded and
 * soft-deleted rows are filtered in code, mirroring the kyc router.
 */
async function documentsBySubject(
    db: Db,
    subjectType: "organization" | "driver" | "truck" | "trailer" | "link",
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

/**
 * A carrier's contract is called out on its own because it alone decides
 * whether the carrier may operate, whatever else it holds.
 */
function contractState(docs: CurrentDoc[], on: string): ContractState {
    const contract = docs.find((doc) => doc.type === CONTRACT_DOC);

    if (!contract || contract.status !== "approved") return "missing";
    if (contract.expiresAt !== null && contract.expiresAt < on) return "expired";

    return "valid";
}

/** Soonest expiry among the subject's valid documents. */
function nextExpiry(docs: CurrentDoc[]): string | null {
    const dates = docs
        .filter((doc) => doc.status === "approved" && doc.expiresAt !== null)
        .map((doc) => doc.expiresAt as string)
        .sort();

    return dates[0] ?? null;
}

type SubjectTable = typeof organization | typeof driver | typeof truck | typeof trailer | typeof link;

/**
 * Subjects holding an approved document that runs out within `days`.
 *
 * Kept as a reusable condition rather than a count, because the stat card
 * and the list filter it drives have to agree — the card's number and the
 * rows you get from clicking it come from this one definition.
 */
function expiringSubjects(
    db: Db,
    subjectType: KycSubjectType,
    days: number,
    on: string,
) {
    return db
        .select({ id: kycDocument.subjectId })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, subjectType),
            // Only an approved document can expire; a pending or rejected one
            // running out changes nothing that ever counted
            eq(kycDocument.status, "approved"),
            isNull(kycDocument.deletedAt),
            sql`${kycDocument.expiresAt} is not null`,
            lte(kycDocument.expiresAt, addDays(on, days)),
        ));
}

/**
 * Verification counts for the clickable stat cards — one grouped query per
 * page, plus one for the expiry window. Generic over the subject table so
 * all five share it; the only thing it needs from a table is a kycStatus
 * column and an id.
 */
async function statusBuckets(
    db: Db,
    table: SubjectTable,
    subjectType: KycSubjectType,
    where?: SQL,
): Promise<StatsBucket> {
    const on = today();

    const [[row], [expiring]] = await Promise.all([
        db.select({
            total: count(),
            pendingReview: sql<number>`count(*) filter (where ${table.kycStatus} = 'pending-review')`.mapWith(Number),
            verified: sql<number>`count(*) filter (where ${table.kycStatus} = 'verified')`.mapWith(Number),
        })
            .from(table)
            .where(where),

        db.select({ value: countDistinct(table.id) })
            .from(table)
            .where(and(inArray(table.id, expiringSubjects(db, subjectType, EXPIRY_WINDOW_DAYS, on)), where)),
    ]);

    return {
        total: row?.total ?? 0,
        pendingReview: row?.pendingReview ?? 0,
        verified: row?.verified ?? 0,
        expiring: expiring?.value ?? 0,
    };
}

export const partnersRouter = createTRPCRouter({
    /**
     * Shippers or carriers, with the order aggregates the list rows show.
     * Two queries per page: the rows, then one grouped aggregate over the
     * orders belonging to exactly those rows.
     */
    organizations: authorizedProcedure("organizations", ["read"])
        .input(z.object({ ...PageInput, type: z.enum(["shipper", "carrier"]) }))
        .query(async ({ ctx, input }) => {
            const conditions = [eq(organization.type, input.type)];

            if (input.status) conditions.push(eq(organization.kycStatus, input.status));

            if (input.expiring) {
                conditions.push(inArray(
                    organization.id,
                    expiringSubjects(ctx.db, "organization", input.expiring, today()),
                ));
            }

            if (input.search) {
                const term = `%${escapeLike(input.search)}%`;
                conditions.push(or(
                    ilike(organization.name, term),
                    ilike(organization.nuit, term),
                    ilike(organization.email, term),
                )!);
            }

            const where = and(...conditions);
            const cursor = input.cursor ?? 1;
            const offset = (cursor - 1) * input.limit;

            const [rows, [total]] = await Promise.all([
                ctx.db
                    .select({
                        id: organization.id,
                        name: organization.name,
                        logo: organization.logo,
                        nuit: organization.nuit,
                        email: organization.email,
                        phoneNumber: organization.phoneNumber,
                        type: organization.type,
                        kycStatus: organization.kycStatus,
                        riskLevel: organization.riskLevel,
                        riskReason: organization.riskReason,
                        physicalAddress: organization.physicalAddress,
                    })
                    .from(organization)
                    .where(where)
                    // Name is not unique; the id tiebreaker keeps OFFSET
                    // pages from overlapping or skipping rows
                    .orderBy(asc(organization.name), asc(organization.id))
                    .limit(input.limit)
                    .offset(offset),

                ctx.db.select({ value: count() }).from(organization).where(where),
            ]);

            const ids = rows.map((row) => row.id);
            const party = input.type === "shipper" ? order.shipperId : order.carrierId;
            const paymentStatus = input.type === "shipper" ? order.shipperPaymentStatus : order.carrierPaymentStatus;

            const [orders, docs, fleetCounts] = await Promise.all([
                ids.length === 0 ? [] : ctx.db
                    .select({
                        id: party,
                        total: count(),
                        active: sql<number>`count(*) filter (where ${order.status} in ${ACTIVE_STATUSES})`.mapWith(Number),
                        // A quote that was never taken up and a cancelled
                        // order were never owed, so neither belongs in the
                        // denominator of a payment rate
                        billable: sql<number>`count(*) filter (where ${order.status} not in ('prospect', 'cancelled', 'underbid'))`.mapWith(Number),
                        settled: sql<number>`count(*) filter (where ${paymentStatus} = 'completed')`.mapWith(Number),
                        // Real signal, unlike an on-time *payment* rate: the
                        // order table has no payment due date to measure against
                        onTime: sql<number | null>`avg(case when ${order.arrivalOnTimeOffloading} then 1.0 else 0.0 end)
                            filter (where ${order.status} = 'completed' and ${order.arrivalOnTimeOffloading} is not null)`.mapWith(Number),
                    })
                    .from(order)
                    .where(inArray(party, ids))
                    .groupBy(party),

                documentsBySubject(ctx.db, "organization", ids),

                input.type !== "carrier" || ids.length === 0 ? [] : ctx.db
                    .select({ id: truck.carrierId, value: count() })
                    .from(truck)
                    .where(inArray(truck.carrierId, ids))
                    .groupBy(truck.carrierId),
            ]);

            const byOrg = new Map(orders.map((row) => [row.id, row]));
            const byFleet = new Map(fleetCounts.map((row) => [row.id, row.value]));
            const on = today();

            const items: OrgRow[] = rows.map((row) => {
                const documents = docs.get(row.id) ?? [];
                const aggregate = byOrg.get(row.id);
                const totalOrders = aggregate?.total ?? 0;

                return {
                    ...row,
                    city: city(row.physicalAddress),
                    progress: docProgress(subjectKind("organization", row.type), documents, on),
                    contract: row.type === "carrier" ? contractState(documents, on) : null,
                    nextExpiry: nextExpiry(documents),
                    activeOrders: aggregate?.active ?? 0,
                    totalOrders,
                    // Share of *invoiced* orders whose money is fully settled
                    // — not an on-time rate, which this schema cannot support
                    settledRate: (aggregate?.billable ?? 0) > 0
                        ? (aggregate?.settled ?? 0) / (aggregate?.billable ?? 1)
                        : null,
                    onTimeRate: aggregate?.onTime ?? null,
                    fleetSize: byFleet.get(row.id) ?? 0,
                };
            });

            const totalCount = total?.value ?? 0;

            return {
                items,
                total: totalCount,
                nextCursor: offset + items.length < totalCount ? cursor + 1 : undefined,
            };
        }),

    organizationStats: authorizedProcedure("organizations", ["read"])
        .input(z.object({ type: z.enum(["shipper", "carrier"]) }))
        .query(({ ctx, input }) =>
            statusBuckets(ctx.db, organization, "organization", eq(organization.type, input.type)),
        ),

    /** Drivers across every carrier, with their current assignment. */
    drivers: authorizedProcedure("organizations", ["read"])
        .input(z.object(PageInput))
        .query(async ({ ctx, input }) => {
            const conditions = [];

            if (input.status) conditions.push(eq(driver.kycStatus, input.status));

            if (input.expiring) {
                conditions.push(inArray(
                    driver.id,
                    expiringSubjects(ctx.db, "driver", input.expiring, today()),
                ));
            }

            if (input.search) {
                const term = `%${escapeLike(input.search)}%`;
                conditions.push(or(
                    ilike(user.name, term),
                    ilike(user.email, term),
                    ilike(user.phoneNumber, term),
                )!);
            }

            const where = conditions.length > 0 ? and(...conditions) : undefined;
            const cursor = input.cursor ?? 1;
            const offset = (cursor - 1) * input.limit;

            const [rows, [total]] = await Promise.all([
                ctx.db
                    .select({
                        id: driver.id,
                        name: user.name,
                        image: user.image,
                        email: user.email,
                        phoneNumber: user.phoneNumber,
                        carrierId: driver.carrierId,
                        carrierName: organization.name,
                        kycStatus: driver.kycStatus,
                        assignedPlate: truck.regPlate,
                    })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .leftJoin(organization, eq(organization.id, driver.carrierId))
                    .leftJoin(truck, eq(truck.id, driver.truckId))
                    .where(where)
                    // Names are not unique; id keeps OFFSET pages stable
                    .orderBy(asc(user.name), asc(driver.id))
                    .limit(input.limit)
                    .offset(offset),

                ctx.db
                    .select({ value: count() })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .where(where),
            ]);

            const ids = rows.map((row) => row.id);

            const [active, docs] = await Promise.all([
                ids.length === 0 ? [] : ctx.db
                    .select({
                        driverId: order.driverId,
                        status: order.status,
                        truckPlate: order.truckPlate,
                        loadingAddress: order.loadingAddress,
                        offloadingAddress: order.offloadingAddress,
                        category: order.category,
                        year: order.year,
                        seq: order.seq,
                    })
                    .from(order)
                    .where(and(
                        inArray(order.driverId, ids),
                        inArray(order.status, ACTIVE_STATUSES),
                    ))
                    .orderBy(desc(order.year), desc(order.seq)),

                documentsBySubject(ctx.db, "driver", ids),
            ]);

            // Rows arrive newest first, so the first hit per driver is current
            const byDriver = new Map<string, (typeof active)[number]>();
            for (const row of active) {
                if (row.driverId && !byDriver.has(row.driverId)) byDriver.set(row.driverId, row);
            }

            const on = today();

            const items: DriverRow[] = rows.map((row) => {
                const documents = docs.get(row.id) ?? [];
                const trip = byDriver.get(row.id);

                return {
                    ...row,
                    progress: docProgress("driver", documents, on),
                    nextExpiry: nextExpiry(documents),
                    trip: trip ? tripSummary(trip) : null,
                    // The live assignment wins over the standing one
                    plate: trip?.truckPlate ?? row.assignedPlate,
                };
            });

            const totalCount = total?.value ?? 0;

            return {
                items,
                total: totalCount,
                nextCursor: offset + items.length < totalCount ? cursor + 1 : undefined,
            };
        }),

    driverStats: authorizedProcedure("organizations", ["read"])
        .query(({ ctx }) => statusBuckets(ctx.db, driver, "driver")),

    /** Trucks, trailers or links across every carrier. */
    vehicles: authorizedProcedure("organizations", ["read"])
        .input(z.object({ ...PageInput, kind: vehicleKind }))
        .query(async ({ ctx, input }) => {
            const table = VEHICLE_TABLE[input.kind];
            const conditions = [];

            if (input.status) conditions.push(eq(table.kycStatus, input.status));

            if (input.expiring) {
                conditions.push(inArray(
                    table.id,
                    expiringSubjects(ctx.db, input.kind, input.expiring, today()),
                ));
            }

            if (input.search) {
                const term = `%${escapeLike(input.search)}%`;
                // Both sides must be normalized the same way. Stripping only
                // spaces from the column while stripping every separator from
                // the term means a plate stored as "SD-752069247" can never be
                // found by typing "SD752069247".
                const plate = `%${escapeLike(input.search.toLowerCase().replace(/[^a-z0-9]/g, ""))}%`;

                conditions.push(or(
                    sql`regexp_replace(lower(${table.regPlate}), '[^a-z0-9]', '', 'g') like ${plate}`,
                    ilike(table.brand, term),
                    ilike(table.model, term),
                    ilike(organization.name, term),
                )!);
            }

            const where = conditions.length > 0 ? and(...conditions) : undefined;
            const cursor = input.cursor ?? 1;
            const offset = (cursor - 1) * input.limit;

            const [rows, [total]] = await Promise.all([
                ctx.db
                    .select({
                        id: table.id,
                        regPlate: table.regPlate,
                        internalId: table.internalId,
                        brand: table.brand,
                        model: table.model,
                        year: table.year,
                        loadingBay: table.loadingBay,
                        carrierId: table.carrierId,
                        carrierName: organization.name,
                        kycStatus: table.kycStatus,
                        ownershipStatus: table.ownershipStatus,
                        ownerName: table.ownerName,
                    })
                    .from(table)
                    .leftJoin(organization, eq(organization.id, table.carrierId))
                    .where(where)
                    .orderBy(asc(table.regPlate))
                    .limit(input.limit)
                    .offset(offset),

                ctx.db
                    .select({ value: count() })
                    .from(table)
                    .leftJoin(organization, eq(organization.id, table.carrierId))
                    .where(where),
            ]);

            const plates = rows.map((row) => row.regPlate);
            const ids = rows.map((row) => row.id);

            // Which order column carries this kind of vehicle
            const plateColumn =
                input.kind === "truck" ? order.truckPlate :
                    input.kind === "trailer" ? order.trailerPlate :
                        order.linkPlate;

            const [active, docs] = await Promise.all([
                plates.length === 0 ? [] : ctx.db
                    .select({
                        plate: plateColumn,
                        status: order.status,
                        loadingAddress: order.loadingAddress,
                        offloadingAddress: order.offloadingAddress,
                        category: order.category,
                        driverName: user.name,
                        year: order.year,
                        seq: order.seq,
                    })
                    .from(order)
                    .leftJoin(driver, eq(driver.id, order.driverId))
                    .leftJoin(user, eq(user.id, driver.userId))
                    .where(and(
                        inArray(plateColumn, plates),
                        inArray(order.status, ACTIVE_STATUSES),
                    ))
                    .orderBy(desc(order.year), desc(order.seq)),

                documentsBySubject(ctx.db, input.kind, ids),
            ]);

            const byPlate = new Map<string, (typeof active)[number]>();
            for (const row of active) {
                if (row.plate && !byPlate.has(row.plate)) byPlate.set(row.plate, row);
            }

            const on = today();

            const items: VehicleRow[] = rows.map((row) => {
                const documents = docs.get(row.id) ?? [];
                const trip = byPlate.get(row.regPlate);

                return {
                    ...row,
                    kind: input.kind,
                    capacity: (row.loadingBay as LoadingBay | null)?.capacity ?? null,
                    progress: docProgress(input.kind, documents, on),
                    nextExpiry: nextExpiry(documents),
                    trip: trip ? tripSummary(trip) : null,
                    driverName: trip?.driverName ?? null,
                };
            });

            const totalCount = total?.value ?? 0;

            return {
                items,
                total: totalCount,
                nextCursor: offset + items.length < totalCount ? cursor + 1 : undefined,
            };
        }),

    vehicleStats: authorizedProcedure("organizations", ["read"])
        .input(z.object({ kind: vehicleKind }))
        .query(({ ctx, input }) => statusBuckets(ctx.db, VEHICLE_TABLE[input.kind], input.kind)),
});

// Statuses at which the cargo is aboard and the rig is between the two
// addresses; before them it is still heading for the loading point
const IN_TRANSIT: string[] = ["on-route", "at-border", "at-offloading", "offloading", "stopped", "issue"];

/**
 * Where the rig is and what it is carrying, as far as the order table knows.
 * There is no live telemetry here — the position is inferred from the
 * shipment's status, so it says "heading to X", never "is at X".
 */
function tripSummary(trip: {
    status: string
    loadingAddress: Location | null
    offloadingAddress: Location | null
    category: string | null
}) {
    return {
        inTransit: IN_TRANSIT.includes(trip.status),
        from: city(trip.loadingAddress),
        to: city(trip.offloadingAddress),
        load: trip.category,
    };
}

