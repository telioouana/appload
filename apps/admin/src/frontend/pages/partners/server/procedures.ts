import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, countDistinct, desc, eq, gte, ilike, inArray, isNotNull, isNull, like, lte, ne, notInArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { invitation, member, organization, user } from "@workspace/db/users";
import { order, type Location } from "@workspace/db/orders";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { chatConversation, chatMessage } from "@workspace/db/chats";
import { kycDocument } from "@workspace/db/kyc-documents";
import { CLAIM_STATUS, organizationClaim } from "@workspace/db/connections";
import { notificationCursor } from "@workspace/db/notifications";
import { KYC_STATUS, OWNERSHIP_STATUS, PARTNER_ORG_TYPE, isPartnerOrgType, type KycStatus, type KycSubjectType, type LoadingBay } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { brandedEmail, sendEmail } from "@workspace/auth/email";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types";
import { notify } from "@workspace/domain/notifications";
import { trackingAllowance } from "@workspace/domain/subscription";
import { addDays, docProgress, today, type CurrentDoc } from "@workspace/domain/kyc/derive";
import { CONTRACT_DOC, subjectKind } from "@workspace/domain/kyc/requirements";
import {
    CONTRACT_FILTERS,
    DRIVER_SORTS,
    EXPIRY_WINDOW_DAYS,
    ISSUE_STATUSES,
    ORGANIZATION_SORTS,
    OWNER_TYPES,
    PLACEHOLDER_PATTERNS,
    RISK_FILTERS,
    STATUS_FILTERS,
    VEHICLE_SORTS,
    isPlaceholder,
} from "@/frontend/pages/partners/types";
import type {
    ContractState,
    DriverRow,
    OrgRow,
    PagedResult,
    StatsBucket,
    StatusCounts,
    StatusFilter,
    VehicleKind,
    VehicleRow,
    WhatsappStatus,
} from "@/frontend/pages/partners/types";

type Db = typeof Database;

const vehicleKind = z.enum(["truck", "trailer", "link"]);
const organizationType = z.enum(["shipper", "carrier"]);

const VEHICLE_TABLE = { truck, trailer, link } as const;

// Rows an export may carry; enough for the whole prod directory today
const EXPORT_LIMIT = 2000;

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const PageInput = {
    search: z.string().trim().max(120).optional(),
    status: z.enum(STATUS_FILTERS).optional(),
    // Days-until-expiry window; set by the expiring tile
    expiring: z.coerce.number().int().positive().max(365).optional(),
    // Rows whose NUIT, email or phone is still a sync placeholder
    incomplete: z.boolean().optional(),
    // The 1-based page index; absent means the first page
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
    dir: z.enum(["asc", "desc"]).default("asc"),
};

const OrganizationsInput = z.object({
    ...PageInput,
    type: organizationType,
    sort: z.enum(ORGANIZATION_SORTS).optional(),
    contract: z.enum(CONTRACT_FILTERS).optional(),
    risk: z.enum(RISK_FILTERS).optional(),
    province: z.string().trim().max(120).optional(),
    // Rows with a portal claim still waiting on a decision
    claims: z.boolean().optional(),
});

const DriversInput = z.object({
    ...PageInput,
    sort: z.enum(DRIVER_SORTS).optional(),
    phone: z.literal("missing").optional(),
    unassigned: z.boolean().optional(),
    carrier: z.string().optional(),
    owner: z.enum(OWNER_TYPES).default("carrier"),
});

const VehiclesInput = z.object({
    ...PageInput,
    kind: vehicleKind,
    sort: z.enum(VEHICLE_SORTS).optional(),
    ownership: z.enum(OWNERSHIP_STATUS).optional(),
    unassigned: z.boolean().optional(),
    carrier: z.string().optional(),
    owner: z.enum(OWNER_TYPES).default("carrier"),
});

/** The owner scope the fleet pages and their tiles share (see OWNER_TYPES). */
const OwnerInput = z.object({ owner: z.enum(OWNER_TYPES).default("carrier") });

type OrganizationsInput = z.infer<typeof OrganizationsInput>;
type DriversInput = z.infer<typeof DriversInput>;
type VehiclesInput = z.infer<typeof VehiclesInput>;

type Paging = { page?: number; pageSize: number };

/** City label for a jsonb Location, falling back to its full address. */
const city = (location: Location | null | undefined) =>
    location?.state || location?.country || location?.address || null;

/** The page index and offset a paged read asked for. */
function paging(input: Paging) {
    const page = input.page ?? 1;
    return { page, offset: (page - 1) * input.pageSize, limit: input.pageSize };
}

function paged<T>(items: T[], total: number, input: Paging): PagedResult<T> {
    const { page } = paging(input);

    return {
        items,
        total,
        page,
        pageSize: input.pageSize,
    };
}

const direction = (dir: "asc" | "desc") => (dir === "desc" ? desc : asc);

type Column = AnyColumn;

/** A column holding one of the sync scripts' stand-in values. */
const placeholder = (column: Column, patterns: readonly string[]) =>
    or(...patterns.map((pattern) => like(column, pattern)))!;

const statusCondition = (column: Column, status: StatusFilter) =>
    status === "issues" ? inArray(column, ISSUE_STATUSES) : eq(column, status);

/**
 * The live document set for a batch of subjects, keyed by subject id.
 * One query for the whole page rather than one per row: superseded and
 * soft-deleted rows are filtered in code, mirroring the kyc router.
 */
async function documentsBySubject(
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

/** The type of the document that expires soonest, for the profile header. */
function nextExpiryType(docs: CurrentDoc[]): string | null {
    const soonest = docs
        .filter((doc) => doc.status === "approved" && doc.expiresAt !== null)
        .sort((a, b) => (a.expiresAt as string).localeCompare(b.expiresAt as string))[0];

    return soonest?.type ?? null;
}

type SubjectTable = typeof organization | typeof driver | typeof truck | typeof trailer | typeof link;

/**
 * Subjects holding an approved document that runs out within `days`.
 *
 * Kept as a reusable condition rather than a count, because the tile and
 * the list filter it drives have to agree — the tile's number and the rows
 * you get from clicking it come from this one definition.
 */
function expiringSubjects(db: Db, subjectType: KycSubjectType, days: number, on: string) {
    return db
        .select({ id: kycDocument.subjectId })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, subjectType),
            // Only an approved document can expire; a pending or rejected one
            // running out changes nothing that ever counted
            eq(kycDocument.status, "approved"),
            isNull(kycDocument.deletedAt),
            isNotNull(kycDocument.expiresAt),
            lte(kycDocument.expiresAt, addDays(on, days)),
        ));
}

/**
 * Organizations holding a usable signed contract today: approved, not
 * replaced by a newer upload, not deleted and not past its expiry. Both the
 * "no contract" tile and the contract filter read from this one subquery.
 */
function contractedSubjects(db: Db, on: string) {
    const replaced = db
        .select({ id: kycDocument.supersedesId })
        .from(kycDocument)
        .where(isNotNull(kycDocument.supersedesId));

    return db
        .select({ id: kycDocument.subjectId })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, "organization"),
            eq(kycDocument.type, CONTRACT_DOC),
            eq(kycDocument.status, "approved"),
            isNull(kycDocument.deletedAt),
            or(isNull(kycDocument.expiresAt), gte(kycDocument.expiresAt, on)),
            notInArray(kycDocument.id, replaced),
        ));
}

/** Organizations someone has asked to own on the portal, still undecided. */
const claimedOrganizations = (db: Db) =>
    db
        .select({ id: organizationClaim.organizationId })
        .from(organizationClaim)
        .where(eq(organizationClaim.status, "pending"));

const incompleteOrganization = () =>
    or(
        placeholder(organization.nuit, PLACEHOLDER_PATTERNS.nuit),
        placeholder(organization.email, PLACEHOLDER_PATTERNS.email),
        placeholder(organization.phoneNumber, PLACEHOLDER_PATTERNS.phone),
    )!;

const missingDriverPhone = () =>
    or(isNull(user.phoneNumber), placeholder(user.phoneNumber, PLACEHOLDER_PATTERNS.phone))!;

/**
 * Whether a number is on WhatsApp, as far as our own chat history knows.
 * Meta offers no lookup any more, so the evidence is what happened when we
 * messaged the number: an inbound message or a delivered/read outbound one
 * proves it; an outbound message that failed last says it is not reachable
 * right now; no history at all means nobody knows yet.
 */
async function whatsappEvidence(db: Db, phones: (string | null)[]): Promise<Map<string, WhatsappStatus>> {
    const byPhone = new Map<string, WhatsappStatus>();
    // Chat identities are bare digits (Infobip's format); user phones are E.164
    const digits = [...new Set(phones.map((phone) => (phone ?? "").replace(/\D/g, "")).filter(Boolean))];

    if (digits.length === 0) return byPhone;

    const rows = await db
        .select({
            phone: chatConversation.driverPhone,
            proven: sql<boolean>`bool_or(${chatMessage.direction} = 'inbound' or ${chatMessage.status} in ('delivered', 'read'))`,
            // The status of the most recent outbound message, if any
            lastOutbound: sql<string | null>`(array_agg(${chatMessage.status} order by ${chatMessage.createdAt} desc) filter (where ${chatMessage.direction} = 'outbound'))[1]`,
        })
        .from(chatConversation)
        .innerJoin(chatMessage, eq(chatMessage.conversationId, chatConversation.id))
        .where(inArray(chatConversation.driverPhone, digits))
        .groupBy(chatConversation.driverPhone);

    for (const row of rows) {
        byPhone.set(row.phone, row.lastOutbound === "failed" ? "unreachable" : row.proven ? "confirmed" : "unknown");
    }

    return byPhone;
}

const whatsappFor = (evidence: Map<string, WhatsappStatus>, phone: string | null): WhatsappStatus =>
    evidence.get((phone ?? "").replace(/\D/g, "")) ?? "unknown";

/** Trucks nobody drives; trailers and links hitched to nothing. */
function unassignedVehicle(db: Db, kind: VehicleKind): SQL {
    if (kind === "truck") {
        return notInArray(truck.id, db.select({ id: driver.truckId }).from(driver).where(isNotNull(driver.truckId)));
    }
    if (kind === "trailer") return isNull(trailer.truckId);
    return isNull(link.trailerId);
}

const statusCount = (column: Column, status: KycStatus) =>
    sql<number>`count(*) filter (where ${column} = ${status})`.mapWith(Number);

const conditionCount = (condition: SQL) =>
    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/**
 * Verification counts for the status tabs — one grouped query per page,
 * plus one for the expiry window. Generic over the subject table so all
 * five share it; the only thing it needs from a table is a kycStatus column
 * and an id.
 */
async function statusBuckets(
    db: Db,
    table: SubjectTable,
    subjectType: KycSubjectType,
    where?: SQL,
): Promise<Omit<StatsBucket, "attention">> {
    const on = today();

    const [[row], [expiring]] = await Promise.all([
        db.select({
            total: count(),
            draft: statusCount(table.kycStatus, "draft"),
            "pending-review": statusCount(table.kycStatus, "pending-review"),
            verified: statusCount(table.kycStatus, "verified"),
            rejected: statusCount(table.kycStatus, "rejected"),
            expired: statusCount(table.kycStatus, "expired"),
            suspended: statusCount(table.kycStatus, "suspended"),
        })
            .from(table)
            .where(where),

        db.select({ value: countDistinct(table.id) })
            .from(table)
            .where(and(inArray(table.id, expiringSubjects(db, subjectType, EXPIRY_WINDOW_DAYS, on)), where)),
    ]);

    const byStatus = Object.fromEntries(
        KYC_STATUS.map((status) => [status, row?.[status] ?? 0]),
    ) as StatusCounts;

    return {
        total: row?.total ?? 0,
        byStatus,
        issues: ISSUE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
        expiring: expiring?.value ?? 0,
    };
}

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

/** The `metadata` column is free-form JSON; the representee lives there. */
function representeeOf(metadata: string | null): string | null {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata) as { representee?: unknown };
        return typeof parsed.representee === "string" && parsed.representee.trim() ? parsed.representee : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

function organizationConditions(db: Db, input: OrganizationsInput): SQL {
    const conditions: SQL[] = [eq(organization.type, input.type)];
    const on = today();

    if (input.status) conditions.push(statusCondition(organization.kycStatus, input.status));
    if (input.expiring) conditions.push(inArray(organization.id, expiringSubjects(db, "organization", input.expiring, on)));
    if (input.incomplete) conditions.push(incompleteOrganization());
    if (input.contract === "valid") conditions.push(inArray(organization.id, contractedSubjects(db, on)));
    if (input.contract === "missing") conditions.push(notInArray(organization.id, contractedSubjects(db, on)));
    if (input.risk === "flagged") conditions.push(ne(organization.riskLevel, "none"));
    if (input.risk === "watch" || input.risk === "high") conditions.push(eq(organization.riskLevel, input.risk));
    if (input.province) conditions.push(eq(sql`${organization.physicalAddress}->>'state'`, input.province));
    if (input.claims) conditions.push(inArray(organization.id, claimedOrganizations(db)));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(or(
            ilike(organization.name, term),
            ilike(organization.nuit, term),
            ilike(organization.email, term),
            ilike(organization.phoneNumber, term),
        )!);
    }

    return and(...conditions)!;
}

function organizationOrder(input: OrganizationsInput): SQL[] {
    const dir = direction(input.dir);
    const party = input.type === "shipper" ? order.shipperId : order.carrierId;

    switch (input.sort) {
        case "status":
            return [dir(organization.kycStatus), asc(organization.name), asc(organization.id)];
        case "orders":
            return [
                dir(sql`(select count(*) from ${order} where ${party} = ${organization.id})`),
                asc(organization.name),
                asc(organization.id),
            ];
        case "created":
            return [dir(organization.createdAt), asc(organization.id)];
        default:
            // Name is not unique; the id tiebreaker keeps OFFSET pages from
            // overlapping or skipping rows
            return [dir(organization.name), asc(organization.id)];
    }
}

/**
 * Shippers or carriers, with the order aggregates the list rows show. Two
 * queries per page: the rows, then one grouped aggregate over the orders
 * belonging to exactly those rows. Shared by the paged list and the export.
 */
async function listOrganizations(db: Db, input: OrganizationsInput, limit: number, offset: number) {
    const where = organizationConditions(db, input);

    const [rows, [total]] = await Promise.all([
        db
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
            .orderBy(...organizationOrder(input))
            .limit(limit)
            .offset(offset),

        db.select({ value: count() }).from(organization).where(where),
    ]);

    const ids = rows.map((row) => row.id);
    const party = input.type === "shipper" ? order.shipperId : order.carrierId;
    const paymentStatus = input.type === "shipper" ? order.shipperPaymentStatus : order.carrierPaymentStatus;

    const [orders, docs, fleetCounts, driverCounts] = await Promise.all([
        ids.length === 0 ? [] : db
            .select({
                id: party,
                total: count(),
                active: sql<number>`count(*) filter (where ${order.status} in ${ACTIVE_STATUSES})`.mapWith(Number),
                // A quote that was never taken up and a cancelled order were
                // never owed, so neither belongs in the denominator of a
                // payment rate
                billable: sql<number>`count(*) filter (where ${order.status} not in ('prospect', 'cancelled', 'underbid'))`.mapWith(Number),
                settled: sql<number>`count(*) filter (where ${paymentStatus} = 'completed')`.mapWith(Number),
                // Real signal, unlike an on-time *payment* rate: the order
                // table has no payment due date to measure against
                onTime: sql<number | null>`avg(case when ${order.arrivalOnTimeOffloading} then 1.0 else 0.0 end)
                    filter (where ${order.status} = 'completed' and ${order.arrivalOnTimeOffloading} is not null)`.mapWith(Number),
            })
            .from(order)
            .where(inArray(party, ids))
            .groupBy(party),

        documentsBySubject(db, "organization", ids),

        input.type !== "carrier" || ids.length === 0 ? [] : db
            .select({ id: truck.carrierId, value: count() })
            .from(truck)
            .where(inArray(truck.carrierId, ids))
            .groupBy(truck.carrierId),

        input.type !== "carrier" || ids.length === 0 ? [] : db
            .select({ id: driver.carrierId, value: count() })
            .from(driver)
            .where(inArray(driver.carrierId, ids))
            .groupBy(driver.carrierId),
    ]);

    const byOrg = new Map(orders.map((row) => [row.id, row]));
    const byFleet = new Map(fleetCounts.map((row) => [row.id, row.value]));
    const byDrivers = new Map(driverCounts.map((row) => [row.id, row.value]));
    const on = today();

    const items: OrgRow[] = rows.map((row) => {
        const documents = docs.get(row.id) ?? [];
        const aggregate = byOrg.get(row.id);

        return {
            ...row,
            // One type at a time — `organizationConditions` filters on it,
            // and the column itself now also admits Appload's own row
            type: input.type,
            city: city(row.physicalAddress),
            progress: docProgress(subjectKind("organization", input.type), documents, on),
            contract: row.type === "carrier" ? contractState(documents, on) : null,
            nextExpiry: nextExpiry(documents),
            activeOrders: aggregate?.active ?? 0,
            totalOrders: aggregate?.total ?? 0,
            // Share of *invoiced* orders whose money is fully settled — not
            // an on-time rate, which this schema cannot support
            settledRate: (aggregate?.billable ?? 0) > 0
                ? (aggregate?.settled ?? 0) / (aggregate?.billable ?? 1)
                : null,
            onTimeRate: aggregate?.onTime ?? null,
            fleetSize: byFleet.get(row.id) ?? 0,
            driverCount: byDrivers.get(row.id) ?? 0,
        };
    });

    return { items, total: total?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/**
 * Assets owned by one kind of organization. The fleet tables key on
 * `carrier_id`, which since the portal opened fleet registration to shippers
 * is any owning organization — this is what tells the two apart.
 */
function ownedBy(db: Db, column: AnyColumn, owner: z.infer<typeof OwnerInput>["owner"]): SQL | undefined {
    if (owner === "all") return undefined;

    return inArray(column, db.select({ id: organization.id }).from(organization).where(eq(organization.type, owner)));
}

function driverConditions(db: Db, input: DriversInput): SQL | undefined {
    const conditions: SQL[] = [];

    const owner = ownedBy(db, driver.carrierId, input.owner);
    if (owner) conditions.push(owner);

    if (input.status) conditions.push(statusCondition(driver.kycStatus, input.status));
    if (input.expiring) conditions.push(inArray(driver.id, expiringSubjects(db, "driver", input.expiring, today())));
    if (input.phone === "missing" || input.incomplete) conditions.push(missingDriverPhone());
    if (input.unassigned) conditions.push(isNull(driver.truckId));
    if (input.carrier) conditions.push(eq(driver.carrierId, input.carrier));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(or(
            ilike(user.name, term),
            ilike(user.email, term),
            ilike(user.phoneNumber, term),
            ilike(driver.passport, term),
            ilike(truck.regPlate, term),
        )!);
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
}

function driverOrder(input: DriversInput): SQL[] {
    const dir = direction(input.dir);

    switch (input.sort) {
        case "status":
            return [dir(driver.kycStatus), asc(user.name), asc(driver.id)];
        case "carrier":
            return [dir(organization.name), asc(user.name), asc(driver.id)];
        case "created":
            return [dir(driver.createdAt), asc(driver.id)];
        default:
            // Names are not unique; id keeps OFFSET pages stable
            return [dir(user.name), asc(driver.id)];
    }
}

/** Drivers across every carrier, with their current assignment. */
async function listDrivers(db: Db, input: DriversInput, limit: number, offset: number) {
    const where = driverConditions(db, input);

    const [rows, [total]] = await Promise.all([
        db
            .select({
                id: driver.id,
                name: user.name,
                image: user.image,
                email: user.email,
                phoneNumber: user.phoneNumber,
                passport: driver.passport,
                carrierId: driver.carrierId,
                carrierName: organization.name,
                kycStatus: driver.kycStatus,
                truckId: driver.truckId,
                assignedPlate: truck.regPlate,
            })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .leftJoin(organization, eq(organization.id, driver.carrierId))
            .leftJoin(truck, eq(truck.id, driver.truckId))
            .where(where)
            .orderBy(...driverOrder(input))
            .limit(limit)
            .offset(offset),

        db
            .select({ value: count() })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .leftJoin(organization, eq(organization.id, driver.carrierId))
            .leftJoin(truck, eq(truck.id, driver.truckId))
            .where(where),
    ]);

    const ids = rows.map((row) => row.id);

    const [active, docs, whatsapp] = await Promise.all([
        ids.length === 0 ? [] : db
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
            .where(and(inArray(order.driverId, ids), inArray(order.status, ACTIVE_STATUSES)))
            .orderBy(desc(order.year), desc(order.seq)),

        documentsBySubject(db, "driver", ids),

        whatsappEvidence(db, rows.map((row) => row.phoneNumber)),
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
            whatsapp: whatsappFor(whatsapp, row.phoneNumber),
        };
    });

    return { items, total: total?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

function vehicleConditions(db: Db, input: VehiclesInput): SQL | undefined {
    const table = VEHICLE_TABLE[input.kind];
    const conditions: SQL[] = [];

    const owner = ownedBy(db, table.carrierId, input.owner);
    if (owner) conditions.push(owner);

    if (input.status) conditions.push(statusCondition(table.kycStatus, input.status));
    if (input.expiring) conditions.push(inArray(table.id, expiringSubjects(db, input.kind, input.expiring, today())));
    if (input.ownership) conditions.push(eq(table.ownershipStatus, input.ownership));
    if (input.unassigned) conditions.push(unassignedVehicle(db, input.kind));
    if (input.carrier) conditions.push(eq(table.carrierId, input.carrier));
    // A vehicle's "profile" is its ownership paperwork; incomplete means
    // nobody has established who owns it yet
    if (input.incomplete) conditions.push(eq(table.ownershipStatus, "unverified"));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        // Both sides must be normalized the same way. Stripping only spaces
        // from the column while stripping every separator from the term
        // means a plate stored as "SD-752069247" can never be found by
        // typing "SD752069247".
        const plate = `%${escapeLike(input.search.toLowerCase().replace(/[^a-z0-9]/g, ""))}%`;

        conditions.push(or(
            sql`regexp_replace(lower(${table.regPlate}), '[^a-z0-9]', '', 'g') like ${plate}`,
            ilike(table.brand, term),
            ilike(table.model, term),
            ilike(table.vin, term),
            ilike(organization.name, term),
        )!);
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
}

function vehicleOrder(input: VehiclesInput): SQL[] {
    const table = VEHICLE_TABLE[input.kind];
    const dir = direction(input.dir);

    switch (input.sort) {
        case "status":
            return [dir(table.kycStatus), asc(table.regPlate)];
        case "carrier":
            return [dir(organization.name), asc(table.regPlate)];
        case "year":
            return [dir(table.year), asc(table.regPlate)];
        case "created":
            return [dir(table.createdAt), asc(table.regPlate)];
        default:
            return [dir(table.regPlate)];
    }
}

/** Trucks, trailers or links across every carrier. */
async function listVehicles(db: Db, input: VehiclesInput, limit: number, offset: number) {
    const table = VEHICLE_TABLE[input.kind];
    const where = vehicleConditions(db, input);

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
                carrierId: table.carrierId,
                carrierName: organization.name,
                kycStatus: table.kycStatus,
                ownershipStatus: table.ownershipStatus,
                ownerName: table.ownerName,
                truckType: input.kind === "truck" ? truck.type : sql<null>`null`,
            })
            .from(table)
            .leftJoin(organization, eq(organization.id, table.carrierId))
            .where(where)
            .orderBy(...vehicleOrder(input))
            .limit(limit)
            .offset(offset),

        db
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

    const [active, docs, standing] = await Promise.all([
        plates.length === 0 ? [] : db
            .select({
                plate: plateColumn,
                status: order.status,
                loadingAddress: order.loadingAddress,
                offloadingAddress: order.offloadingAddress,
                category: order.category,
                driverName: user.name,
                driverId: order.driverId,
                year: order.year,
                seq: order.seq,
            })
            .from(order)
            .leftJoin(driver, eq(driver.id, order.driverId))
            .leftJoin(user, eq(user.id, driver.userId))
            .where(and(inArray(plateColumn, plates), inArray(order.status, ACTIVE_STATUSES)))
            .orderBy(desc(order.year), desc(order.seq)),

        documentsBySubject(db, input.kind, ids),

        // The standing assignment: the driver whose home truck this is
        input.kind !== "truck" || ids.length === 0 ? [] : db
            .select({ truckId: driver.truckId, driverId: driver.id, driverName: user.name })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(inArray(driver.truckId, ids)),
    ]);

    const byPlate = new Map<string, (typeof active)[number]>();
    for (const row of active) {
        if (row.plate && !byPlate.has(row.plate)) byPlate.set(row.plate, row);
    }

    const byTruck = new Map(standing.map((row) => [row.truckId, row]));
    const on = today();

    const items: VehicleRow[] = rows.map((row) => {
        const documents = docs.get(row.id) ?? [];
        const trip = byPlate.get(row.regPlate);
        const home = byTruck.get(row.id);

        return {
            ...row,
            kind: input.kind,
            capacity: (row.loadingBay as LoadingBay | null)?.capacity ?? null,
            progress: docProgress(input.kind, documents, on),
            nextExpiry: nextExpiry(documents),
            trip: trip ? tripSummary(trip) : null,
            // The live assignment wins over the standing one
            driverName: trip?.driverName ?? home?.driverName ?? null,
            driverId: trip?.driverId ?? home?.driverId ?? null,
        };
    });

    return { items, total: total?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type RecentOrder = {
    id: string
    orderId: string
    status: string
    from: string | null
    to: string | null
    date: Date | null
    driverName: string | null
    truckPlate: string | null
};

const recentOrderColumns = {
    id: order.id,
    orderId: order.orderId,
    status: order.status,
    loadingAddress: order.loadingAddress,
    offloadingAddress: order.offloadingAddress,
    expectedLoadingDate: order.expectedLoadingDate,
    driverName: order.driverName,
    truckPlate: order.truckPlate,
};

const toRecentOrder = (row: {
    id: string; orderId: string; status: string;
    loadingAddress: Location | null; offloadingAddress: Location | null;
    expectedLoadingDate: Date | null; driverName: string | null; truckPlate: string | null;
}): RecentOrder => ({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    from: city(row.loadingAddress),
    to: city(row.offloadingAddress),
    date: row.expectedLoadingDate,
    driverName: row.driverName,
    truckPlate: row.truckPlate,
});

/** How many of the fields a complete profile needs are actually filled. */
function completeness(fields: Record<string, boolean>) {
    const missing = Object.entries(fields).filter(([, filled]) => !filled).map(([key]) => key);

    return { filled: Object.keys(fields).length - missing.length, total: Object.keys(fields).length, missing };
}

const orderAggregate = (paymentStatus?: AnyColumn) => ({
    total: count(),
    active: sql<number>`count(*) filter (where ${order.status} in ${ACTIVE_STATUSES})`.mapWith(Number),
    billable: sql<number>`count(*) filter (where ${order.status} not in ('prospect', 'cancelled', 'underbid'))`.mapWith(Number),
    settled: paymentStatus
        ? sql<number>`count(*) filter (where ${paymentStatus} = 'completed')`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    onTime: sql<number | null>`avg(case when ${order.arrivalOnTimeOffloading} then 1.0 else 0.0 end)
        filter (where ${order.status} = 'completed' and ${order.arrivalOnTimeOffloading} is not null)`.mapWith(Number),
});

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

// How long an owner invitation stays acceptable
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

/** An absolute link into the partner portal, which is a separate origin. */
const portalUrl = (path: string) => `${process.env.NEXT_PUBLIC_PORTAL_URL ?? ""}${path}`;

/**
 * A Portuguese transactional email to a partner. Portal copy is pt only
 * (§5 of the plan): these people never chose a language with us. A provider
 * failure is logged, never thrown — the decision it accompanies is already
 * written and must not be rolled back by an email.
 */
async function sendPortalEmail(params: {
    to: string;
    subject: string;
    title: string;
    lines: string[];
    ctaLabel: string;
    ctaUrl: string;
    disclaimer: string;
}): Promise<void> {
    const result = await sendEmail({
        to: [params.to],
        subject: params.subject,
        html: brandedEmail({
            title: params.title,
            lines: params.lines,
            ctaLabel: params.ctaLabel,
            ctaUrl: params.ctaUrl,
            disclaimer: params.disclaimer,
            locale: "pt",
        }),
    });

    if (!result.ok) {
        console.error(`[portal] email "${params.subject}" failed:`, result.error);
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const partnersRouter = createTRPCRouter({
    organizations: authorizedProcedure("organizations", ["read"])
        .input(OrganizationsInput)
        .query(async ({ ctx, input }) => {
            const { limit, offset } = paging(input);
            const { items, total } = await listOrganizations(ctx.db, input, limit, offset);

            return paged(items, total, input);
        }),

    organizationStats: authorizedProcedure("organizations", ["read"])
        .input(z.object({ type: organizationType }))
        .query(async ({ ctx, input }): Promise<StatsBucket> => {
            const scope = eq(organization.type, input.type);
            const on = today();

            const [buckets, [attention]] = await Promise.all([
                statusBuckets(ctx.db, organization, "organization", scope),
                ctx.db
                    .select({
                        incomplete: conditionCount(incompleteOrganization()),
                        risk: conditionCount(ne(organization.riskLevel, "none")),
                        contract: input.type === "carrier"
                            ? conditionCount(notInArray(organization.id, contractedSubjects(ctx.db, on)))
                            : sql<number>`0`.mapWith(Number),
                    })
                    .from(organization)
                    .where(scope),
            ]);

            return {
                ...buckets,
                attention: {
                    incomplete: attention?.incomplete ?? 0,
                    risk: attention?.risk ?? 0,
                    ...(input.type === "carrier" ? { contract: attention?.contract ?? 0 } : {}),
                },
            };
        }),

    /** The provinces on file for a party type, most common first — for the filter menu. */
    organizationProvinces: authorizedProcedure("organizations", ["read"])
        .input(z.object({ type: organizationType }))
        .query(async ({ ctx, input }) => {
            const province = sql<string>`${organization.physicalAddress}->>'state'`;

            const rows = await ctx.db
                .select({ province, value: count() })
                .from(organization)
                .where(and(eq(organization.type, input.type), isNotNull(province), ne(province, "")))
                .groupBy(province)
                .orderBy(desc(count()), asc(province))
                .limit(40);

            return rows.map((row) => ({ province: row.province, count: row.value }));
        }),

    exportOrganizations: authorizedProcedure("organizations", ["read"])
        .input(OrganizationsInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const { items } = await listOrganizations(ctx.db, { ...input, pageSize: EXPORT_LIMIT }, EXPORT_LIMIT, 0);
            return items;
        }),

    drivers: authorizedProcedure("organizations", ["read"])
        .input(DriversInput)
        .query(async ({ ctx, input }) => {
            const { limit, offset } = paging(input);
            const { items, total } = await listDrivers(ctx.db, input, limit, offset);

            return paged(items, total, input);
        }),

    driverStats: authorizedProcedure("organizations", ["read"])
        .input(OwnerInput)
        .query(async ({ ctx, input }): Promise<StatsBucket> => {
            // The same owner scope as the list, so a tile always counts
            // exactly the rows it opens
            const owner = ownedBy(ctx.db, driver.carrierId, input.owner);

            const [buckets, [attention]] = await Promise.all([
                statusBuckets(ctx.db, driver, "driver", owner),
                ctx.db
                    .select({
                        phone: conditionCount(missingDriverPhone()),
                        unassigned: conditionCount(isNull(driver.truckId)),
                    })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .where(owner),
            ]);

            return {
                ...buckets,
                attention: { phone: attention?.phone ?? 0, unassigned: attention?.unassigned ?? 0 },
            };
        }),

    exportDrivers: authorizedProcedure("organizations", ["read"])
        .input(DriversInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const { items } = await listDrivers(ctx.db, { ...input, pageSize: EXPORT_LIMIT }, EXPORT_LIMIT, 0);
            return items;
        }),

    vehicles: authorizedProcedure("organizations", ["read"])
        .input(VehiclesInput)
        .query(async ({ ctx, input }) => {
            const { limit, offset } = paging(input);
            const { items, total } = await listVehicles(ctx.db, input, limit, offset);

            return paged(items, total, input);
        }),

    vehicleStats: authorizedProcedure("organizations", ["read"])
        .input(OwnerInput.extend({ kind: vehicleKind }))
        .query(async ({ ctx, input }): Promise<StatsBucket> => {
            const table = VEHICLE_TABLE[input.kind];
            // The same owner scope as the list, so a tile always counts
            // exactly the rows it opens
            const owner = ownedBy(ctx.db, table.carrierId, input.owner);

            const [buckets, [attention]] = await Promise.all([
                statusBuckets(ctx.db, table, input.kind, owner),
                ctx.db
                    .select({
                        ownership: conditionCount(eq(table.ownershipStatus, "unverified")),
                        unassigned: conditionCount(unassignedVehicle(ctx.db, input.kind)),
                    })
                    .from(table)
                    .where(owner),
            ]);

            return {
                ...buckets,
                attention: { ownership: attention?.ownership ?? 0, unassigned: attention?.unassigned ?? 0 },
            };
        }),

    exportVehicles: authorizedProcedure("organizations", ["read"])
        .input(VehiclesInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const { items } = await listVehicles(ctx.db, { ...input, pageSize: EXPORT_LIMIT }, EXPORT_LIMIT, 0);
            return items;
        }),

    /** Everything the profile panel's overview shows for a shipper or carrier. */
    organizationProfile: authorizedProcedure("organizations", ["read"])
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    logo: organization.logo,
                    nuit: organization.nuit,
                    email: organization.email,
                    phoneNumber: organization.phoneNumber,
                    type: organization.type,
                    status: organization.status,
                    kycStatus: organization.kycStatus,
                    riskLevel: organization.riskLevel,
                    riskReason: organization.riskReason,
                    riskFlaggedAt: organization.riskFlaggedAt,
                    billingAddress: organization.billingAddress,
                    physicalAddress: organization.physicalAddress,
                    metadata: organization.metadata,
                    createdAt: organization.createdAt,
                    // Portal standing: null activation means the company
                    // exists here but nobody signs in for it yet
                    portalActivatedAt: organization.portalActivatedAt,
                    subscriptionPlan: organization.subscriptionPlan,
                    subscriptionExpiresAt: organization.subscriptionExpiresAt,
                })
                .from(organization)
                .where(eq(organization.id, input.id));

            // Appload is a partner on the platform, not one of its partners:
            // this panel is written for a shipper or a carrier and nothing else
            if (!row || !isPartnerOrgType(row.type)) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const party = row.type === "shipper" ? order.shipperId : order.carrierId;
            const paymentStatus = row.type === "shipper" ? order.shipperPaymentStatus : order.carrierPaymentStatus;
            const on = today();
            const isCarrier = row.type === "carrier";

            const [docs, [aggregate], recent, [trucks], [trailers], [links], [drivers]] = await Promise.all([
                documentsBySubject(ctx.db, "organization", [row.id]),
                ctx.db.select(orderAggregate(paymentStatus)).from(order).where(eq(party, row.id)),
                ctx.db
                    .select(recentOrderColumns)
                    .from(order)
                    .where(eq(party, row.id))
                    .orderBy(desc(order.year), desc(order.seq))
                    .limit(5),
                isCarrier ? ctx.db.select({ value: count() }).from(truck).where(eq(truck.carrierId, row.id)) : [{ value: 0 }],
                isCarrier ? ctx.db.select({ value: count() }).from(trailer).where(eq(trailer.carrierId, row.id)) : [{ value: 0 }],
                isCarrier ? ctx.db.select({ value: count() }).from(link).where(eq(link.carrierId, row.id)) : [{ value: 0 }],
                isCarrier ? ctx.db.select({ value: count() }).from(driver).where(eq(driver.carrierId, row.id)) : [{ value: 0 }],
            ]);

            const documents = docs.get(row.id) ?? [];
            const { metadata, ...profile } = row;
            const representee = representeeOf(metadata);

            return {
                ...profile,
                // The guard above narrowed the reference, not the rest of the
                // row: the column itself also admits Appload's own type
                type: row.type,
                representee,
                city: city(row.physicalAddress),
                progress: docProgress(subjectKind("organization", row.type), documents, on),
                contract: isCarrier ? contractState(documents, on) : null,
                contractExpiresAt: documents.find((doc) => doc.type === CONTRACT_DOC && doc.status === "approved")?.expiresAt ?? null,
                nextExpiry: nextExpiry(documents),
                nextExpiryType: nextExpiryType(documents),
                completeness: completeness({
                    name: Boolean(row.name),
                    nuit: !isPlaceholder("nuit", row.nuit),
                    email: !isPlaceholder("email", row.email),
                    phone: !isPlaceholder("phone", row.phoneNumber),
                    representee: Boolean(representee),
                    billingAddress: Boolean(row.billingAddress),
                    physicalAddress: Boolean(row.physicalAddress),
                }),
                performance: {
                    totalOrders: aggregate?.total ?? 0,
                    activeOrders: aggregate?.active ?? 0,
                    settledRate: (aggregate?.billable ?? 0) > 0
                        ? (aggregate?.settled ?? 0) / (aggregate?.billable ?? 1)
                        : null,
                    onTimeRate: aggregate?.onTime ?? null,
                },
                fleet: {
                    trucks: trucks?.value ?? 0,
                    trailers: trailers?.value ?? 0,
                    links: links?.value ?? 0,
                    drivers: drivers?.value ?? 0,
                },
                recentOrders: recent.map(toRecentOrder),
            };
        }),

    /** A carrier's trucks, trailers, links and drivers, for the profile tabs. */
    organizationFleet: authorizedProcedure("organizations", ["read"])
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const vehicleColumns = (table: typeof truck | typeof trailer | typeof link) => ({
                id: table.id,
                regPlate: table.regPlate,
                brand: table.brand,
                model: table.model,
                year: table.year,
                kycStatus: table.kycStatus,
                ownershipStatus: table.ownershipStatus,
            });

            const [trucks, trailers, links, drivers] = await Promise.all([
                ctx.db.select(vehicleColumns(truck)).from(truck).where(eq(truck.carrierId, input.id)).orderBy(asc(truck.regPlate)).limit(200),
                ctx.db.select(vehicleColumns(trailer)).from(trailer).where(eq(trailer.carrierId, input.id)).orderBy(asc(trailer.regPlate)).limit(200),
                ctx.db.select(vehicleColumns(link)).from(link).where(eq(link.carrierId, input.id)).orderBy(asc(link.regPlate)).limit(200),
                ctx.db
                    .select({
                        id: driver.id,
                        name: user.name,
                        image: user.image,
                        phoneNumber: user.phoneNumber,
                        passport: driver.passport,
                        kycStatus: driver.kycStatus,
                        plate: truck.regPlate,
                    })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .leftJoin(truck, eq(truck.id, driver.truckId))
                    .where(eq(driver.carrierId, input.id))
                    .orderBy(asc(user.name))
                    .limit(200),
            ]);

            return { trucks, trailers, links, drivers };
        }),

    /** Everything the profile panel shows for a driver. */
    driverProfile: authorizedProcedure("organizations", ["read"])
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select({
                    id: driver.id,
                    userId: driver.userId,
                    name: user.name,
                    image: user.image,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    passport: driver.passport,
                    carrierId: driver.carrierId,
                    carrierName: organization.name,
                    kycStatus: driver.kycStatus,
                    status: driver.status,
                    truckId: driver.truckId,
                    plate: truck.regPlate,
                    truckBrand: truck.brand,
                    truckModel: truck.model,
                    createdAt: driver.createdAt,
                })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .leftJoin(organization, eq(organization.id, driver.carrierId))
                .leftJoin(truck, eq(truck.id, driver.truckId))
                .where(eq(driver.id, input.id));

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const on = today();

            const [docs, [aggregate], recent, whatsapp] = await Promise.all([
                documentsBySubject(ctx.db, "driver", [row.id]),
                ctx.db.select(orderAggregate()).from(order).where(eq(order.driverId, row.id)),
                ctx.db
                    .select({ ...recentOrderColumns, category: order.category })
                    .from(order)
                    .where(eq(order.driverId, row.id))
                    .orderBy(desc(order.year), desc(order.seq))
                    .limit(5),
                whatsappEvidence(ctx.db, [row.phoneNumber]),
            ]);

            const documents = docs.get(row.id) ?? [];
            const current = recent.find((entry) => (ACTIVE_STATUSES as string[]).includes(entry.status));

            return {
                ...row,
                whatsapp: whatsappFor(whatsapp, row.phoneNumber),
                progress: docProgress("driver", documents, on),
                nextExpiry: nextExpiry(documents),
                nextExpiryType: nextExpiryType(documents),
                trip: current ? tripSummary(current) : null,
                completeness: completeness({
                    name: Boolean(row.name),
                    phone: !isPlaceholder("phone", row.phoneNumber),
                    email: !isPlaceholder("email", row.email),
                    passport: Boolean(row.passport),
                    truck: Boolean(row.truckId),
                }),
                performance: {
                    totalOrders: aggregate?.total ?? 0,
                    activeOrders: aggregate?.active ?? 0,
                    onTimeRate: aggregate?.onTime ?? null,
                },
                recentOrders: recent.map(toRecentOrder),
            };
        }),

    /** Everything the profile panel shows for a truck, trailer or link. */
    vehicleProfile: authorizedProcedure("organizations", ["read"])
        .input(z.object({ kind: vehicleKind, id: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
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
                    carrierId: table.carrierId,
                    carrierName: organization.name,
                    carrierNuit: organization.nuit,
                    kycStatus: table.kycStatus,
                    status: table.status,
                    ownershipStatus: table.ownershipStatus,
                    ownerName: table.ownerName,
                    ownerNuit: table.ownerNuit,
                    truckType: input.kind === "truck" ? truck.type : sql<null>`null`,
                    createdAt: table.createdAt,
                })
                .from(table)
                .leftJoin(organization, eq(organization.id, table.carrierId))
                .where(eq(table.id, input.id));

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const plateColumn =
                input.kind === "truck" ? order.truckPlate :
                    input.kind === "trailer" ? order.trailerPlate :
                        order.linkPlate;
            const on = today();

            const [docs, [aggregate], recent, assigned] = await Promise.all([
                documentsBySubject(ctx.db, input.kind, [row.id]),
                ctx.db.select(orderAggregate()).from(order).where(eq(plateColumn, row.regPlate)),
                ctx.db
                    .select({ ...recentOrderColumns, category: order.category })
                    .from(order)
                    .where(eq(plateColumn, row.regPlate))
                    .orderBy(desc(order.year), desc(order.seq))
                    .limit(5),
                input.kind !== "truck" ? [] : ctx.db
                    .select({ id: driver.id, name: user.name, phoneNumber: user.phoneNumber, kycStatus: driver.kycStatus })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .where(eq(driver.truckId, row.id))
                    .orderBy(asc(user.name)),
            ]);

            const documents = docs.get(row.id) ?? [];
            const current = recent.find((entry) => (ACTIVE_STATUSES as string[]).includes(entry.status));
            const bay = row.loadingBay as LoadingBay | null;

            return {
                ...row,
                kind: input.kind,
                capacity: bay?.capacity ?? null,
                progress: docProgress(input.kind, documents, on),
                nextExpiry: nextExpiry(documents),
                nextExpiryType: nextExpiryType(documents),
                trip: current ? tripSummary(current) : null,
                drivers: assigned,
                completeness: completeness({
                    brand: Boolean(row.brand),
                    model: Boolean(row.model),
                    year: Boolean(row.year),
                    vin: Boolean(row.vin),
                    loadingBay: input.kind === "truck" && row.truckType === "articulated" ? true : Boolean(bay),
                    ownership: row.ownershipStatus !== "unverified",
                }),
                performance: {
                    totalOrders: aggregate?.total ?? 0,
                    activeOrders: aggregate?.active ?? 0,
                },
                recentOrders: recent.map(toRecentOrder),
            };
        }),

    /** More of a subject's orders than the overview shows, newest first. */
    subjectOrders: authorizedProcedure("organizations", ["read"])
        .input(z.object({
            subjectType: z.enum(["shipper", "carrier", "driver", "truck", "trailer", "link"]),
            subjectId: z.string().nonempty(),
            limit: z.number().int().min(1).max(100).default(25),
        }))
        .query(async ({ ctx, input }) => {
            let condition: SQL;

            if (input.subjectType === "shipper") condition = eq(order.shipperId, input.subjectId);
            else if (input.subjectType === "carrier") condition = eq(order.carrierId, input.subjectId);
            else if (input.subjectType === "driver") condition = eq(order.driverId, input.subjectId);
            else {
                const table = VEHICLE_TABLE[input.subjectType];
                const [vehicle] = await ctx.db.select({ regPlate: table.regPlate }).from(table).where(eq(table.id, input.subjectId));
                if (!vehicle) return [];

                const plateColumn =
                    input.subjectType === "truck" ? order.truckPlate :
                        input.subjectType === "trailer" ? order.trailerPlate :
                            order.linkPlate;
                condition = eq(plateColumn, vehicle.regPlate);
            }

            const rows = await ctx.db
                .select({ ...recentOrderColumns, shipperName: order.shipperName, carrierName: order.carrierName })
                .from(order)
                .where(condition)
                .orderBy(desc(order.year), desc(order.seq))
                .limit(input.limit);

            return rows.map((row) => ({ ...toRecentOrder(row), shipperName: row.shipperName, carrierName: row.carrierName }));
        }),

    /**
     * The ⌘K palette: a company, a driver or a plate from any page. Small
     * queries in parallel, a handful of hits each — a palette shows the best
     * few matches, not a list.
     */
    search: authorizedProcedure("organizations", ["read"])
        .input(z.object({ query: z.string().trim().min(1).max(120) }))
        .query(async ({ ctx, input }) => {
            const term = `%${escapeLike(input.query)}%`;
            const compact = input.query.toLowerCase().replace(/[^a-z0-9]/g, "");
            const plate = `%${escapeLike(compact)}%`;

            const vehicleHits = (kind: VehicleKind) => {
                const table = VEHICLE_TABLE[kind];
                return ctx.db
                    .select({
                        id: table.id,
                        regPlate: table.regPlate,
                        brand: table.brand,
                        model: table.model,
                        carrierName: organization.name,
                        ownershipStatus: table.ownershipStatus,
                        kycStatus: table.kycStatus,
                    })
                    .from(table)
                    .leftJoin(organization, eq(organization.id, table.carrierId))
                    .where(sql`regexp_replace(lower(${table.regPlate}), '[^a-z0-9]', '', 'g') like ${plate}`)
                    .orderBy(asc(table.regPlate))
                    .limit(5)
                    .then((rows) => rows.map((row) => ({ ...row, kind })));
            };

            const [organizations, drivers, trucks, trailers, links] = await Promise.all([
                ctx.db
                    .select({
                        id: organization.id,
                        name: organization.name,
                        type: organization.type,
                        nuit: organization.nuit,
                        kycStatus: organization.kycStatus,
                        physicalAddress: organization.physicalAddress,
                    })
                    .from(organization)
                    // Shippers and carriers only: the palette's hits open a
                    // partner profile, and Appload's own row has none
                    .where(and(
                        inArray(organization.type, [...PARTNER_ORG_TYPE]),
                        or(
                            ilike(organization.name, term),
                            ilike(organization.nuit, term),
                            ilike(organization.email, term),
                            ilike(organization.phoneNumber, term),
                        ),
                    ))
                    .orderBy(asc(organization.name))
                    .limit(6),

                ctx.db
                    .select({
                        id: driver.id,
                        name: user.name,
                        phoneNumber: user.phoneNumber,
                        carrierName: organization.name,
                        plate: truck.regPlate,
                        kycStatus: driver.kycStatus,
                    })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .leftJoin(organization, eq(organization.id, driver.carrierId))
                    .leftJoin(truck, eq(truck.id, driver.truckId))
                    .where(or(ilike(user.name, term), ilike(user.phoneNumber, term), ilike(driver.passport, term)))
                    .orderBy(asc(user.name))
                    .limit(5),

                compact.length >= 2 ? vehicleHits("truck") : [],
                compact.length >= 2 ? vehicleHits("trailer") : [],
                compact.length >= 2 ? vehicleHits("link") : [],
            ]);

            return {
                organizations: organizations.map(({ physicalAddress, ...row }) => ({ ...row, city: city(physicalAddress) })),
                drivers,
                vehicles: [...trucks, ...trailers, ...links].slice(0, 6),
            };
        }),

    /**
     * Portal claims: a user asking to own a company that already exists here
     * but has nobody on the portal yet. Pending by default — that is the
     * queue ops works from.
     */
    claims: authorizedProcedure("organizations", ["read"])
        .input(z.object({
            organizationId: z.string().optional(),
            status: z.enum(CLAIM_STATUS).optional(),
        }))
        .query(async ({ ctx, input }) => {
            return ctx.db
                .select({
                    id: organizationClaim.id,
                    status: organizationClaim.status,
                    autoApproved: organizationClaim.autoApproved,
                    decisionNote: organizationClaim.decisionNote,
                    decidedAt: organizationClaim.decidedAt,
                    createdAt: organizationClaim.createdAt,
                    organizationId: organizationClaim.organizationId,
                    organizationName: organization.name,
                    organizationType: organization.type,
                    organizationEmail: organization.email,
                    userId: organizationClaim.userId,
                    userName: user.name,
                    userEmail: user.email,
                    emailVerified: user.emailVerified,
                })
                .from(organizationClaim)
                .innerJoin(organization, eq(organization.id, organizationClaim.organizationId))
                .innerJoin(user, eq(user.id, organizationClaim.userId))
                .where(and(
                    eq(organizationClaim.status, input.status ?? "pending"),
                    input.organizationId ? eq(organizationClaim.organizationId, input.organizationId) : undefined,
                ))
                .orderBy(asc(organizationClaim.createdAt))
                .limit(100);
        }),

    /**
     * Ops answering a claim. Approving is what actually puts a company on
     * the portal: the claimant becomes its owner, the activation date is
     * stamped, and the notification cursor starts at now — a company joining
     * today must not wake up to years of its own order history.
     *
     * neon-http has no transactions, so the writes are ordered so a failure
     * in the middle leaves something a retry can finish: membership first
     * (the only step that can still refuse), the claim's own row last.
     */
    decideClaim: authorizedProcedure("organizations", ["update"])
        .input(z.object({
            id: z.string().nonempty(),
            decision: z.enum(["approve", "reject"]),
            note: z.string().trim().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const [claim] = await ctx.db
                .select({
                    id: organizationClaim.id,
                    status: organizationClaim.status,
                    organizationId: organizationClaim.organizationId,
                    organizationName: organization.name,
                    portalActivatedAt: organization.portalActivatedAt,
                    userId: organizationClaim.userId,
                    userName: user.name,
                    userEmail: user.email,
                })
                .from(organizationClaim)
                .innerJoin(organization, eq(organization.id, organizationClaim.organizationId))
                .innerJoin(user, eq(user.id, organizationClaim.userId))
                .where(eq(organizationClaim.id, input.id));

            if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            if (claim.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "ALREADY_DECIDED" });

            const decidedAt = new Date();
            const note = input.note?.trim() || null;

            if (input.decision === "reject") {
                await ctx.db
                    .update(organizationClaim)
                    .set({ status: "rejected", decisionNote: note, decidedBy: ctx.session.user.id, decidedAt })
                    .where(eq(organizationClaim.id, claim.id));

                await sendPortalEmail({
                    to: claim.userEmail,
                    subject: `Pedido de acesso a ${claim.organizationName}`,
                    title: "Pedido de acesso não aprovado",
                    lines: [
                        `O seu pedido para gerir ${claim.organizationName} no Appload Enterprise não foi aprovado.`,
                        ...(note ? [`Motivo: ${note}`] : []),
                        "Se acha que se trata de um engano, fale connosco e resolvemos.",
                    ],
                    ctaLabel: "Voltar ao portal",
                    ctaUrl: portalUrl("/onboarding"),
                    disclaimer: "Se não fez este pedido, ignore este email.",
                });

                return { id: claim.id, status: "rejected" as const };
            }

            // Idempotent: a retry after a half-written approval must not fail
            // here with "already a member"
            const [existing] = await ctx.db
                .select({ id: member.id })
                .from(member)
                .where(and(eq(member.organizationId, claim.organizationId), eq(member.userId, claim.userId)));

            if (!existing) {
                await ctx.authApi.addMember({
                    body: { userId: claim.userId, organizationId: claim.organizationId, role: "owner" },
                });
            }

            if (!claim.portalActivatedAt) {
                await ctx.db
                    .update(organization)
                    .set({ portalActivatedAt: decidedAt })
                    .where(and(eq(organization.id, claim.organizationId), isNull(organization.portalActivatedAt)));
            }

            // Created, never moved: an existing cursor is a materializer's
            // position, and rewinding it would replay the trail
            await ctx.db
                .insert(notificationCursor)
                .values({ organizationId: claim.organizationId, lastHistoryCreatedAt: decidedAt })
                .onConflictDoNothing();

            await ctx.db
                .update(organizationClaim)
                .set({ status: "approved", decisionNote: note, decidedBy: ctx.session.user.id, decidedAt })
                .where(eq(organizationClaim.id, claim.id));

            await notify(ctx.db, {
                organizationId: claim.organizationId,
                kind: "claim.approved",
                userIds: [claim.userId],
                email: false, // decideClaim emails the claimant directly below; no outbox copy
                entityType: "organization",
                entityId: claim.organizationId,
            });

            await sendPortalEmail({
                to: claim.userEmail,
                subject: `${claim.organizationName} está no Appload Enterprise`,
                title: "Bem-vindo ao Appload Enterprise",
                lines: [
                    `O seu pedido para gerir ${claim.organizationName} foi aprovado.`,
                    "Já pode entrar no portal e acompanhar as suas cargas, parceiros e documentos.",
                ],
                ctaLabel: "Entrar no portal",
                ctaUrl: portalUrl("/dashboard"),
                disclaimer: "Se não fez este pedido, fale connosco antes de entrar.",
            });

            return { id: claim.id, status: "approved" as const };
        }),

    /**
     * Invites the first portal user of a partner company. The organization
     * plugin's own createInvitation demands that the inviter be a member of
     * the organization, which staff never are — so the row is written
     * directly and the email is sent from here.
     */
    inviteOwner: authorizedProcedure("organizations", ["update"])
        .input(z.object({
            organizationId: z.string().nonempty(),
            email: z.email(),
            name: z.string().trim().nonempty().max(120),
        }))
        .mutation(async ({ ctx, input }) => {
            const [org] = await ctx.db
                .select({ id: organization.id, name: organization.name })
                .from(organization)
                .where(eq(organization.id, input.organizationId));

            if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            // Accepting requires the signed-in email to equal this one, and
            // Better Auth compares it as stored
            const email = input.email.trim().toLowerCase();
            const id = crypto.randomUUID();
            const createdAt = new Date();

            await ctx.db.insert(invitation).values({
                id,
                organizationId: org.id,
                email,
                role: "owner",
                status: "pending",
                expiresAt: new Date(createdAt.getTime() + INVITATION_TTL_MS),
                inviterId: ctx.session.user.id,
                name: input.name,
                createdAt,
            });

            await sendPortalEmail({
                to: email,
                subject: `Convite para gerir ${org.name} na Appload`,
                title: `Junte-se a ${org.name} na Appload`,
                lines: [
                    `A Appload convidou-o para gerir ${org.name} no Appload Enterprise.`,
                    "O convite é válido durante 48 horas.",
                ],
                ctaLabel: "Aceitar o convite",
                ctaUrl: portalUrl(`/accept-invitation/${id}`),
                disclaimer: "Se não estava à espera deste convite, ignore este email.",
            });

            return { id, email };
        }),

    /** Who signs in for a partner company today, and who is still invited. */
    portalMembers: authorizedProcedure("organizations", ["read"])
        .input(z.object({ organizationId: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const [members, invitations] = await Promise.all([
                ctx.db
                    .select({
                        id: member.id,
                        userId: member.userId,
                        name: user.name,
                        email: user.email,
                        role: member.role,
                        createdAt: member.createdAt,
                    })
                    .from(member)
                    .innerJoin(user, eq(user.id, member.userId))
                    .where(eq(member.organizationId, input.organizationId))
                    .orderBy(asc(member.createdAt)),

                ctx.db
                    .select({
                        id: invitation.id,
                        name: invitation.name,
                        email: invitation.email,
                        role: invitation.role,
                        expiresAt: invitation.expiresAt,
                        createdAt: invitation.createdAt,
                    })
                    .from(invitation)
                    .where(and(eq(invitation.organizationId, input.organizationId), eq(invitation.status, "pending")))
                    .orderBy(desc(invitation.createdAt)),
            ]);

            return { members, invitations };
        }),

    /**
     * The same allowance the portal enforces: the plan, the running month
     * and the tracked movements spent on it, so ops reads the quota off the
     * source rather than counting orders by hand.
     */
    portalUsage: authorizedProcedure("organizations", ["read"])
        .input(z.object({ organizationId: z.string().nonempty() }))
        .query(async ({ ctx, input }) => trackingAllowance(ctx.db, input.organizationId)),

    /** Pending-review counts for the sidebar badges — one small query per table. */
    reviewQueue: authorizedProcedure("organizations", ["read"])
        .query(async ({ ctx }) => {
            const pending = (table: SubjectTable, where?: SQL) =>
                ctx.db.select({ value: count() }).from(table).where(and(eq(table.kycStatus, "pending-review"), where));

            const [[shippers], [carriers], [drivers], [trucks], [trailers], [links], claims] = await Promise.all([
                pending(organization, eq(organization.type, "shipper")),
                pending(organization, eq(organization.type, "carrier")),
                pending(driver),
                pending(truck),
                pending(trailer),
                pending(link),
                // Portal claims are not a kyc status, so they ride their own
                // grouped count — split by party type, since each side has
                // its own list to open
                ctx.db
                    .select({ type: organization.type, value: count() })
                    .from(organizationClaim)
                    .innerJoin(organization, eq(organization.id, organizationClaim.organizationId))
                    .where(eq(organizationClaim.status, "pending"))
                    .groupBy(organization.type),
            ]);

            return {
                shippers: shippers?.value ?? 0,
                carriers: carriers?.value ?? 0,
                drivers: drivers?.value ?? 0,
                fleet: (trucks?.value ?? 0) + (trailers?.value ?? 0) + (links?.value ?? 0),
                pendingClaims: {
                    shipper: claims.find((row) => row.type === "shipper")?.value ?? 0,
                    carrier: claims.find((row) => row.type === "carrier")?.value ?? 0,
                },
                // /carriers/fleets shows one kind at a time, so the summed row
                // above could not open exactly the rows it counts
                fleetByKind: {
                    truck: trucks?.value ?? 0,
                    trailer: trailers?.value ?? 0,
                    link: links?.value ?? 0,
                },
            };
        }),
});
