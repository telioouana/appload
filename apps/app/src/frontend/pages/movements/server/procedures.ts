import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import { partnerConnection } from "@workspace/db/connections";
import type { db as Database } from "@workspace/db/db";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import {
    movement,
    movementCost,
    movementDocument,
    movementLocation,
    movementRoute,
    type CreateMovement,
    type Movement,
    type MovementDispute,
} from "@workspace/db/movements";
import { organization, user } from "@workspace/db/users";
import { APPLOAD_ORG_ID, APPLOAD_ORG_NAME, isApploadOrg } from "@workspace/db/types";

import { brandedEmail, sendEmail } from "@workspace/auth/email";
import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import {
    locationRequestText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";
import { offerToAppload } from "@workspace/domain/appload/link";
import { announce, recordEvent, statusStamps, transitionMovement, type MovementActor } from "@workspace/domain/movements/apply";
import { nextReference } from "@workspace/domain/movements/counters";
import { activeDisputeFor, openDispute, resolveDispute } from "@workspace/domain/movements/disputes";
import { unapprovedPhotos } from "@workspace/domain/movements/documents";
import { isConnected, isOnPortal, organizationName, terminalMovementId } from "@workspace/domain/movements/link";
import { costTotals, exVat, margin, settlementStatus, type Currency } from "@workspace/domain/movements/money";
import { assertExecutor, convertMovement, offerMovement, respondToOffer, withdrawOffer } from "@workspace/domain/movements/offer";
import { editableGroups, isExecutorOf, movementRole, type EditableGroup } from "@workspace/domain/movements/policy";
import { movementRef, needsOrderReference } from "@workspace/domain/movements/refs";
import { entersInProgress, isInProgress, isTerminal, movementFlags } from "@workspace/domain/movements/status";
import { notify } from "@workspace/domain/notifications";
import { assertTrackingAllowance, recordTrackingUsage } from "@workspace/domain/subscription";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { hasOpenSession, place } from "@workspace/domain/tracking/slot";

import { movementDocumentPath } from "@workspace/edgestore/path";

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
import { tenantProcedure } from "@workspace/trpc/tenant";

import { withinRateLimit } from "@/lib/rate-limit";
import {
    AddCostBaseSchema,
    AddMovementDocumentBaseSchema,
    ApproveMovementDocumentBaseSchema,
    ConvertMovementBaseSchema,
    CreateMovementBaseSchema,
    MOVEMENT_STATUS,
    OfferMovementBaseSchema,
    OpenDisputeBaseSchema,
    RecordPaymentBaseSchema,
    ResolveDisputeBaseSchema,
    RespondOfferBaseSchema,
    SendConfirmationBaseSchema,
    TransitionMovementBaseSchema,
    UpdateMovementBaseSchema,
    WithdrawOfferBaseSchema,
    type MoneyLegInput,
    type UpdateMovementInput,
} from "@/backend/schemas/movement";
import { assertEdgeStoreUrl } from "@/frontend/pages/orders/server/projection";
import {
    hasCosts,
    hasParentRow,
    inDispute,
    loadApploadRefs,
    loadCosts,
    loadDisputed,
    loadDisputes,
    loadDocuments,
    loadEvents,
    loadNames,
    loadOffRoute,
    loadOrgEmail,
    loadOwn,
    loadPings,
    loadTerminalProofs,
    loadTerminalRigs,
    loadTrailerPlate,
    loadVisible,
    offRouteRecently,
    partnerMoveNeeds,
    received,
    sectionPredicate,
    silentToday,
    statusFilter,
    toMovementDetail,
    toMovementRow,
    trailIds,
    visibleMovements,
    withPartner,
} from "@/frontend/pages/movements/server/projection";
import {
    MOVEMENT_SCOPES,
    MOVEMENT_SORTS,
    PAGE_SIZES,
    SECTIONS,
    type LoadFormOptions,
    type MovementCashflow,
    type MovementDetail,
    type MovementRow,
    type MovementStats,
    type MovementThreadItem,
    type MovementThreadLoad,
    type OrgType,
    type PagedResult,
} from "@/frontend/pages/movements/types";

type Db = typeof Database;

/**
 * The portal's own loads: one router for both of its lists. What changes
 * status, places an offer or answers one goes through the domain doors
 * (packages/domain/src/movements); this file shapes input, checks who may
 * ask, and hands every response to projection.ts to be cut down to what the
 * caller may see.
 */

// Rows an export may carry, the same ceiling admin's orders export keeps
const EXPORT_LIMIT = 2000;

/** A numeric column as the number it is, or the null it is. */
const numOrNull = (value: string | null) => (value === null ? null : Number(value));

const actorOf = (tenant: { organizationId: string; userId: string }): MovementActor => ({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
});

/**
 * The member's own role, checked after the row is loaded — which statement
 * applies depends on the row: a load the company's own fleet moves is a
 * trip, one it hands to a partner is an order, and placing a load with
 * somebody commits the company to paying them.
 */
function assertCan(role: OrgRole, resource: "trip" | "order" | "offer" | "document" | "dispute", action: string): void {
    if (!isOrgAuthorized(role, resource, [action] as never)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
    }
}

const writeResource = (row: Pick<Movement, "execution">) => (row.execution === "partner" ? "order" : "trip");

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const decimal = (value: number | undefined | null): string | null =>
    value === undefined || value === null ? null : String(Math.round(value * 100) / 100);

/** A money leg as the row's columns, for one side. */
function legColumns(side: "sell" | "buy", value: MoneyLegInput | null): Partial<CreateMovement> {
    if (side === "sell") {
        return {
            sellSubtotal: decimal(value?.subtotal),
            sellVat: decimal(value?.vat),
            sellTotal: decimal(value?.total),
            sellCurrency: value?.currency ?? null,
            sellFiscalRegime: value?.fiscalRegime ?? null,
            ...(value && { sellSettlement: "pending" as const }),
        };
    }

    return {
        buySubtotal: decimal(value?.subtotal),
        buyVat: decimal(value?.vat),
        buyTotal: decimal(value?.total),
        buyCurrency: value?.currency ?? null,
        buyFiscalRegime: value?.fiscalRegime ?? null,
        ...(value && { buySettlement: "pending" as const }),
    };
}

/**
 * A rig named from the fleet has to be the company's own, and a driver named
 * from it brings their name and phone — the tracking asks the phone on file,
 * not whatever was typed beside the picker.
 */
async function resolveRig(
    db: Db,
    tenantId: string,
    input: { driverId?: string | null; truckId?: string | null; trailerId?: string | null; linkId?: string | null },
): Promise<Partial<CreateMovement>> {
    const patch: Partial<CreateMovement> = {};
    const refuse = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

    if (input.driverId) {
        const [row] = await db
            .select({ name: user.name, phone: user.phoneNumber })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(and(eq(driver.id, input.driverId), eq(driver.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("DRIVER_NOT_REGISTERED");

        patch.driverId = input.driverId;
        patch.driverName = row.name;
        if (row.phone) patch.driverPhone = row.phone;
    }

    if (input.truckId) {
        const [row] = await db
            .select({ plate: truck.regPlate })
            .from(truck)
            .where(and(eq(truck.id, input.truckId), eq(truck.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("TRUCK_NOT_REGISTERED");

        patch.truckId = input.truckId;
        patch.truckPlate = row.plate;
    }

    if (input.trailerId) {
        const [row] = await db
            .select({ id: trailer.id })
            .from(trailer)
            .where(and(eq(trailer.id, input.trailerId), eq(trailer.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("TRAILER_NOT_REGISTERED");
        patch.trailerId = input.trailerId;
    }

    if (input.linkId) {
        const [row] = await db
            .select({ id: link.id })
            .from(link)
            .where(and(eq(link.id, input.linkId), eq(link.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("LINK_NOT_REGISTERED");
        patch.linkId = input.linkId;
    }

    return patch;
}

const hasRigInput = (input: Record<string, unknown>) =>
    ["driverName", "driverPhone", "driverId", "truckPlate", "truckId", "trailerId", "linkId"]
        .some((key) => input[key] !== undefined && input[key] !== null);

/** Which editable block each patch field belongs to (policy.ts). */
const FIELD_GROUP: Partial<Record<keyof UpdateMovementInput, EditableGroup>> = {
    origin: "details",
    destination: "details",
    route: "details",
    cargoDescription: "details",
    category: "details",
    weight: "details",
    weightUnit: "details",
    expectedLoadingDate: "details",
    expectedDeliveryAt: "details",
    clientOrgId: "client",
    clientName: "client",
    clientReference: "client",
    sell: "sellAmounts",
    carrierOrgId: "buy",
    carrierName: "buy",
    buy: "buy",
    driverName: "rig",
    driverPhone: "rig",
    driverId: "rig",
    truckPlate: "rig",
    truckId: "rig",
    trailerId: "rig",
    linkId: "rig",
    sellInvoice: "paperwork",
    buyInvoice: "paperwork",
    notes: "paperwork",
};

const ListInput = z.object({
    /** Which tab's list: the page derives it from `?tab=` (types.ts movementsListInput) */
    scope: z.enum(MOVEMENT_SCOPES),
    section: z.enum(SECTIONS).default("all"),
    /** One of the section's tabs; the page's parser only ever sends those */
    status: z.enum(MOVEMENT_STATUS).optional(),
    search: z.string().trim().max(120).optional(),
    /** The tile: asked for a position today and still silent */
    silent: z.literal(true).optional(),
    disputed: z.literal(true).optional(),
    offRoute: z.literal(true).optional(),
    hasCosts: z.literal(true).optional(),
    /** A partner company on the load; only the owner's own rows match */
    partner: z.string().max(64).optional(),
    /** The loading period: a month of the current year, or an explicit range that wins over it */
    month: z.number().int().min(1).max(12).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(MOVEMENT_SORTS).default("newest"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
});

type ListInput = z.infer<typeof ListInput>;

/** The reference, the driver, the plate and the cargo are what a load is looked up by. */
function searchWhere(term: string, tenantId: string): SQL | undefined {
    const pattern = `%${escapeLike(term)}%`;

    return or(
        // Both names a load answers to: the order it is, and the request it
        // was filed as. "ORD-0001" and "0001-26" each find it
        ilike(movement.reference, pattern),
        ilike(movement.requestReference, pattern),
        ilike(movement.driverName, pattern),
        ilike(movement.truckPlate, pattern),
        ilike(movement.cargoDescription, pattern),
        // The client's own reference names the client, which an executor
        // must never learn — and a search that matches a hidden column gives it
        // away one character at a time, by whether the row comes back
        and(
            or(eq(movement.organizationId, tenantId), eq(movement.clientOrgId, tenantId)),
            ilike(movement.clientReference, pattern),
        ),
    );
}

/**
 * The loading period, the way admin's orders list cuts it: an explicit range
 * wins over a month, and a month means that month of the current year.
 */
function loadingPeriod(input: Pick<ListInput, "month" | "from" | "to">): SQL | undefined {
    if (input.from || input.to) {
        return and(
            input.from ? gte(movement.expectedLoadingDate, new Date(`${input.from}T00:00:00`)) : undefined,
            input.to ? lte(movement.expectedLoadingDate, new Date(`${input.to}T23:59:59.999`)) : undefined,
        );
    }

    if (input.month) {
        const year = new Date().getFullYear();

        return and(
            gte(movement.expectedLoadingDate, new Date(year, input.month - 1, 1)),
            lt(movement.expectedLoadingDate, new Date(year, input.month, 1)),
        );
    }

    return undefined;
}

function ordering(sort: ListInput["sort"], dir: "asc" | "desc"): SQL[] {
    const by = (column: AnyColumn) =>
        dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;

    switch (sort) {
        case "loading": return [by(movement.expectedLoadingDate), desc(movement.seq)];
        case "delivery": return [by(movement.expectedDeliveryAt), desc(movement.seq)];
        default: return [by(movement.createdAt), desc(movement.seq)];
    }
}

/** A page of rows cut down for this caller, with the names and trails it needs. */
async function projectRows(db: Db, rows: Movement[], tenantId: string): Promise<MovementRow[]> {
    const roles = rows.map((row) => ({ row, role: roleOrThrow(row, tenantId) }));
    const trails = await trailIds(db, rows);
    const linkedTerminals = rows.filter((row) => row.executionMovementId).map((row) => trails.get(row.id) ?? row.id);
    const [names, pings, rigs, disputed, offRoute, apploadRefs] = await Promise.all([
        loadNames(db, rows.flatMap((row) => [row.organizationId, row.clientOrgId, row.carrierOrgId])),
        loadPings(db, [...trails.values()]),
        loadTerminalRigs(db, linkedTerminals),
        loadDisputed(db, rows.map((row) => row.id)),
        loadOffRoute(db, rows.map((row) => row.id), tenantId),
        loadApploadRefs(db, rows.map((row) => row.orderId)),
    ]);

    return roles.map(({ row, role }) => {
        const trailId = trails.get(row.id) ?? row.id;
        return toMovementRow(row, role, {
            names,
            pings,
            trailId,
            apploadRefs,
            terminalRig: rigs.get(trailId) ?? null,
            // An executor reads a dispute only from its own offer round, which
            // takes the trail to tell. It never needs to here: the only rows a
            // list shows an executor are offers waiting on its answer, and any
            // dispute on one of those is older than the offer — none is ever
            // opened on a load still being asked about. The detail page,
            // which reads the trail, is exact
            inDispute: role !== "executor" && disputed.has(row.id),
            offRoute: offRoute.has(row.id),
        });
    });
}

function roleOrThrow(row: Movement, tenantId: string) {
    const role = movementRole(row, tenantId);
    // The list predicates only ever return rows the caller is a side of; a
    // row with no role here would be a bug in them, and it must not render
    if (!role) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    return role;
}

/**
 * The confirmation must be the file the browser just uploaded for this load.
 * The host check alone is not enough: every object on the delivery host
 * passes it — other loads' papers, and the KYC bucket's, whose whole
 * protection is that its URLs stay secret — and what is named here is
 * fetched by this server, mailed out and filed for the partner to open.
 */
function assertConfirmationUrl(url: string, movementId: string) {
    let path: string;

    try {
        path = decodeURIComponent(new URL(url).pathname);
    } catch {
        path = "";
    }

    assertEdgeStoreUrl(url);

    if (!path.includes(`/${movementDocumentPath(movementId, "transport-order")}/`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

async function detailOf(db: Db, row: Movement, tenantId: string, orgRole: OrgRole, orgType: OrgType): Promise<MovementDetail> {
    const role = roleOrThrow(row, tenantId);
    const owner = role === "owner";
    const trailId = row.executionMovementId ? await terminalMovementId(db, row.id) : row.id;

    const linked = row.executionMovementId !== null;

    const [names, pings, costs, documents, events, disputes, hasParent, executorOnPortal, rigs, terminalProofs, carrierEmail, trailerPlate, photosWaiting, apploadRefs, offRoute] = await Promise.all([
        loadNames(db, [row.organizationId, row.clientOrgId, row.carrierOrgId]),
        loadPings(db, [trailId]),
        owner ? loadCosts(db, row.id) : Promise.resolve([]),
        loadDocuments(db, row.id),
        loadEvents(db, row.id),
        loadDisputes(db, row),
        owner ? hasParentRow(db, row.id) : Promise.resolve(false),
        row.execution === "partner" ? isOnPortal(db, row.carrierOrgId) : Promise.resolve(false),
        linked ? loadTerminalRigs(db, [trailId]) : Promise.resolve(new Map()),
        linked ? loadTerminalProofs(db, trailId) : Promise.resolve([]),
        owner && row.carrierOrgId ? loadOrgEmail(db, row.carrierOrgId) : Promise.resolve(null),
        owner && row.trailerId ? loadTrailerPlate(db, row.trailerId) : Promise.resolve(null),
        // Counted on the row the papers are read from, which is the row the
        // photos are filed against — and only for the company that answers
        // for them: what a load still lacks is the owner's own reading
        owner ? unapprovedPhotos(db, row.id) : Promise.resolve(0),
        loadApploadRefs(db, [row.orderId]),
        owner ? loadOffRoute(db, [row.id], tenantId) : Promise.resolve(new Set<string>()),
    ]);

    return toMovementDetail(row, role, {
        tenantId,
        terminalRig: rigs.get(trailId) ?? null,
        terminalProofs,
        carrierEmail,
        trailerPlate,
        names,
        pings,
        trailId,
        apploadRefs,
        hasParent,
        executorOnPortal,
        offRoute: offRoute.has(row.id),
        costs,
        documents,
        events,
        disputes,
        unapprovedPhotos: photosWaiting,
        orgRole,
        orgType,
    });
}

/**
 * Tells every company on a disputed load but the one that acted — once each,
 * on its own row: the row it owns, else the row naming it as client, else the
 * row it carries. The link and the reference are that row's, and so is the
 * naming rule (projection.ts): the acting company is named to the companies
 * on a row it owns, and to the owner of a row it is the client or carrier of;
 * anybody else reads that a company on the load did it.
 *
 * Who is told was decided when the dispute was opened (`partyOrgIds`) and is
 * never worked out again from the rows as they stand: an owner handed its load
 * back places it with the next carrier, and that carrier must not be told —
 * when it resolves — about a dispute its own page deliberately hides from it.
 * A company that has since lost every role on the chain has no row left to be
 * told on, and is passed over.
 */
async function announceDispute(
    db: Db,
    kind: "movement.dispute-opened" | "movement.dispute-resolved",
    dispute: MovementDispute,
    rowIds: readonly string[],
    actorOrgId: string,
): Promise<void> {
    const rows = await db.select().from(movement).where(inArray(movement.id, [...rowIds]));
    const parties = new Set(dispute.partyOrgIds);
    const recipients = new Map<string, { row: Movement; rank: number }>();

    const consider = (organizationId: string | null, row: Movement, rank: number) => {
        if (!organizationId || organizationId === actorOrgId || !parties.has(organizationId)) return;

        const current = recipients.get(organizationId);
        if (!current || rank < current.rank) recipients.set(organizationId, { row, rank });
    };

    for (const row of rows) {
        consider(row.organizationId, row, 0);
        consider(row.clientOrgId, row, 1);
        // A carrier is on a row only while it is actually involved in it
        if (row.carrierOrgId && isExecutorOf(row, row.carrierOrgId)) consider(row.carrierOrgId, row, 2);
    }

    const actorName = await organizationName(db, actorOrgId);

    for (const [organizationId, { row }] of recipients) {
        const named = actorOrgId === row.organizationId
            || (organizationId === row.organizationId && (actorOrgId === row.clientOrgId || actorOrgId === row.carrierOrgId));

        await notify(db, {
            organizationId,
            kind,
            // A dispute opened is somebody's problem today; one resolved is news
            email: kind === "movement.dispute-opened",
            entityType: "movement",
            entityId: row.id,
            params: {
                ref: movementRef(row),
                origin: place(row.origin),
                destination: place(row.destination),
                reason: dispute.reason,
                organizationName: named ? actorName : "",
                // What the copy selects its unnamed wording on: ICU has no
                // branch for an empty name
                named,
            },
        });
    }
}

export const movementsRouter = createTRPCRouter({
    /** One page of one section of one of the two lists. */
    list: tenantProcedure
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<MovementRow>> => {
            const tenantId = ctx.tenant.organizationId;
            const where = and(
                visibleMovements(tenantId),
                sectionPredicate(input.scope, input.section, tenantId),
                input.status ? statusFilter(input.status) : undefined,
                input.search ? searchWhere(input.search, tenantId) : undefined,
                input.silent ? silentToday(tenantId, new Date()) : undefined,
                input.disputed ? inDispute() : undefined,
                input.offRoute ? offRouteRecently(tenantId) : undefined,
                input.hasCosts ? hasCosts(tenantId) : undefined,
                input.partner ? withPartner(input.partner, tenantId) : undefined,
                loadingPeriod(input),
            );

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select()
                    .from(movement)
                    .where(where)
                    .orderBy(...ordering(input.sort, input.dir))
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db.select({ value: count() }).from(movement).where(where),
            ]);

            return {
                items: await projectRows(ctx.db, rows, tenantId),
                total: counted?.value ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /**
     * The counts behind one tab's sections and status tabs, each of exactly
     * the predicate its link opens — so a number always agrees with its list.
     * The sections in one scan; the statuses in a scan of their own, grouped
     * over the whole list, since a section and a status can share a name.
     */
    stats: tenantProcedure
        .input(z.object({ scope: z.enum(MOVEMENT_SCOPES) }))
        .query(async ({ ctx, input }): Promise<MovementStats> => {
            const tenantId = ctx.tenant.organizationId;

            const select = Object.fromEntries(SECTIONS.map((section) => [
                section,
                sql<number>`count(*) filter (where ${sectionPredicate(input.scope, section, tenantId)})::int`.mapWith(Number),
            ]));

            // Counted inside the list's own base, so the tile and the filtered
            // list it opens hold the same rows
            select.silent = sql<number>`count(*) filter (where ${and(
                sectionPredicate(input.scope, "all", tenantId),
                silentToday(tenantId, new Date()),
            )})::int`.mapWith(Number);

            select.offRoute = sql<number>`count(*) filter (where ${and(
                sectionPredicate(input.scope, "all", tenantId),
                offRouteRecently(tenantId),
            )})::int`.mapWith(Number);

            if (input.scope === "trips") {
                select.received = sql<number>`count(*) filter (where ${received(tenantId)})::int`.mapWith(Number);
            }

            const [[row], statuses] = await Promise.all([
                ctx.db
                    .select(select as Record<string, SQL<number>>)
                    .from(movement)
                    .where(visibleMovements(tenantId)),
                ctx.db
                    .select({ status: movement.status, value: count() })
                    .from(movement)
                    .where(and(visibleMovements(tenantId), sectionPredicate(input.scope, "all", tenantId)))
                    .groupBy(movement.status),
            ]);

            const bySection: MovementStats["bySection"] = Object.fromEntries(
                SECTIONS.map((section) => [section, Number(row?.[section] ?? 0)]),
            );

            return {
                total: bySection.all ?? 0,
                bySection,
                byStatus: Object.fromEntries(statuses.map((entry) => [entry.status, entry.value])),
                received: Number(row?.received ?? 0),
                silent: Number(row?.silent ?? 0),
                offRoute: Number(row?.offRoute ?? 0),
            };
        }),

    /**
     * The money strip above the list: what the company's own rows of the
     * section on screen earn and cost, per currency. Revenue is the sell
     * legs before VAT; costs the buy legs before VAT plus the absorbed cost
     * lines (a rechargeable line passes to the client — money.ts); margin
     * their difference within one currency, never converted and never
     * summed across two. Its own procedure rather than more of `stats`,
     * which the header calls for both scopes and has to stay cheap.
     */
    cashflow: tenantProcedure
        .input(z.object({ scope: z.enum(MOVEMENT_SCOPES), section: z.enum(SECTIONS).default("all") }))
        .query(async ({ ctx, input }): Promise<MovementCashflow> => {
            const tenantId = ctx.tenant.organizationId;
            const owned = and(
                visibleMovements(tenantId),
                sectionPredicate(input.scope, input.section, tenantId),
                eq(movement.organizationId, tenantId),
            );

            const [rows, costGroups] = await Promise.all([
                ctx.db
                    .select({
                        sellSubtotal: movement.sellSubtotal,
                        sellVat: movement.sellVat,
                        sellTotal: movement.sellTotal,
                        sellCurrency: movement.sellCurrency,
                        buySubtotal: movement.buySubtotal,
                        buyVat: movement.buyVat,
                        buyTotal: movement.buyTotal,
                        buyCurrency: movement.buyCurrency,
                    })
                    .from(movement)
                    .where(owned),
                ctx.db
                    .select({
                        currency: movementCost.currency,
                        total: sql<number>`coalesce(sum(${movementCost.amount}), 0)`.mapWith(Number),
                        rechargeable: sql<number>`coalesce(sum(${movementCost.amount}) filter (where ${movementCost.rechargeable}), 0)`.mapWith(Number),
                    })
                    .from(movementCost)
                    .innerJoin(movement, eq(movement.id, movementCost.movementId))
                    .where(and(owned, isNull(movementCost.deletedAt)))
                    .groupBy(movementCost.currency),
            ]);

            // ponytail: folded in memory over the tenant's own rows; move the
            // exVat arithmetic into SQL if row counts ever make this slow
            const lines = new Map<Currency, { revenue: number; costs: number }>();
            const at = (currency: Currency) => {
                const line = lines.get(currency) ?? { revenue: 0, costs: 0 };
                lines.set(currency, line);
                return line;
            };

            for (const row of rows) {
                if (row.sellTotal !== null && row.sellCurrency) {
                    at(row.sellCurrency).revenue += exVat({ subtotal: numOrNull(row.sellSubtotal), vat: numOrNull(row.sellVat), total: Number(row.sellTotal) });
                }
                if (row.buyTotal !== null && row.buyCurrency) {
                    at(row.buyCurrency).costs += exVat({ subtotal: numOrNull(row.buySubtotal), vat: numOrNull(row.buyVat), total: Number(row.buyTotal) });
                }
            }

            for (const group of costGroups) {
                at(group.currency).costs += group.total - group.rechargeable;
            }

            const round = (value: number) => Math.round(value * 100) / 100;

            return {
                lines: [...lines.entries()]
                    .map(([currency, line]) => ({
                        currency,
                        revenue: round(line.revenue),
                        costs: round(line.costs),
                        margin: round(line.revenue - line.costs),
                    }))
                    .sort((a, b) => a.currency.localeCompare(b.currency)),
            };
        }),

    /**
     * The list as a file: the same predicate and order the page shows,
     * uncut by paging, each owned row carrying its cost lines summed per
     * kind and its margin (money.ts — net of what the client repays, blank
     * when the legs disagree on currency). Capped like admin's export.
     */
    export: tenantProcedure
        .input(ListInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const tenantId = ctx.tenant.organizationId;
            const where = and(
                visibleMovements(tenantId),
                sectionPredicate(input.scope, input.section, tenantId),
                input.status ? statusFilter(input.status) : undefined,
                input.search ? searchWhere(input.search, tenantId) : undefined,
                input.silent ? silentToday(tenantId, new Date()) : undefined,
                input.disputed ? inDispute() : undefined,
                input.offRoute ? offRouteRecently(tenantId) : undefined,
                input.hasCosts ? hasCosts(tenantId) : undefined,
                input.partner ? withPartner(input.partner, tenantId) : undefined,
                loadingPeriod(input),
            );

            const rows = await ctx.db
                .select()
                .from(movement)
                .where(where)
                .orderBy(...ordering(input.sort, input.dir))
                .limit(EXPORT_LIMIT);

            const items = await projectRows(ctx.db, rows, tenantId);

            // Cost lines are the owner's own book; other roles export blanks
            const ownedIds = rows.filter((row) => row.organizationId === tenantId).map((row) => row.id);
            const costRows = ownedIds.length === 0 ? [] : await ctx.db
                .select({
                    movementId: movementCost.movementId,
                    kind: movementCost.kind,
                    currency: movementCost.currency,
                    rechargeable: movementCost.rechargeable,
                    amount: sql<number>`sum(${movementCost.amount})`.mapWith(Number),
                })
                .from(movementCost)
                .where(and(inArray(movementCost.movementId, ownedIds), isNull(movementCost.deletedAt)))
                .groupBy(movementCost.movementId, movementCost.kind, movementCost.currency, movementCost.rechargeable);

            const costsOf = new Map<string, typeof costRows>();
            for (const line of costRows) {
                const list = costsOf.get(line.movementId);
                if (list) list.push(line); else costsOf.set(line.movementId, [line]);
            }

            const legAmount = (row: Movement, side: "sell" | "buy") => {
                const total = side === "sell" ? row.sellTotal : row.buyTotal;
                const currency = side === "sell" ? row.sellCurrency : row.buyCurrency;

                if (total === null || currency === null) return null;

                return {
                    amount: exVat({
                        subtotal: numOrNull(side === "sell" ? row.sellSubtotal : row.buySubtotal),
                        vat: numOrNull(side === "sell" ? row.sellVat : row.buyVat),
                        total: Number(total),
                    }),
                    currency,
                };
            };

            return items.map((item, index) => {
                const row = rows[index]!;
                const owner = row.organizationId === tenantId;
                const costs = costsOf.get(item.id) ?? [];
                const totals = costTotals(costs);
                const net = owner
                    ? margin({
                        sell: legAmount(row, "sell"),
                        buy: legAmount(row, "buy"),
                        ownFleet: row.execution === "own-fleet",
                        costs: totals,
                    }).net
                    : null;

                return {
                    ...item,
                    costs: costs.map(({ kind, currency, amount }) => ({ kind, currency, amount })),
                    costTotals: totals,
                    margin: net,
                };
            });
        }),

    /**
     * What the load form picks from: the companies this one is connected to
     * (a client, or a partner to hand the load to — and whether that partner
     * answers on the portal, which decides who names the driver), and its own
     * drivers and trucks. The procedures check every pick again on the way in.
     */
    formOptions: tenantProcedure.query(async ({ ctx }): Promise<LoadFormOptions> => {
        const tenantId = ctx.tenant.organizationId;
        const other = sql<string>`case when ${partnerConnection.requesterOrgId} = ${tenantId} then ${partnerConnection.targetOrgId} else ${partnerConnection.requesterOrgId} end`;

        const [partners, drivers, trucks] = await Promise.all([
            ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    portalActivatedAt: organization.portalActivatedAt,
                })
                .from(partnerConnection)
                .innerJoin(organization, eq(organization.id, other))
                .where(and(
                    eq(partnerConnection.status, "accepted"),
                    or(eq(partnerConnection.requesterOrgId, tenantId), eq(partnerConnection.targetOrgId, tenantId)),
                ))
                .orderBy(asc(organization.name)),
            ctx.db
                .select({ id: driver.id, name: user.name, phone: user.phoneNumber })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .where(eq(driver.carrierId, tenantId))
                .orderBy(asc(user.name)),
            ctx.db
                .select({ id: truck.id, plate: truck.regPlate })
                .from(truck)
                .where(eq(truck.carrierId, tenantId))
                .orderBy(asc(truck.regPlate)),
        ]);

        return {
            // Appload is a partner of every company, pinned in front of the
            // ones it connected to itself: no connection row stands behind it
            partners: [
                { id: APPLOAD_ORG_ID, name: APPLOAD_ORG_NAME, type: "appload" as const, onPortal: true },
                ...partners.map((row) => ({
                    id: row.id,
                    name: row.name,
                    type: row.type,
                    onPortal: row.portalActivatedAt !== null,
                })),
            ],
            drivers: drivers.map((row) => ({ id: row.id, name: row.name, phone: row.phone ?? null })),
            trucks: trucks.map((row) => ({ id: row.id, plate: row.plate })),
        };
    }),

    /**
     * One load in full, as this caller may see it. The buttons come from
     * `permissions`, decided from the same rules the doors enforce.
     */
    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<MovementDetail> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            return detailOf(ctx.db, row, ctx.tenant.organizationId, ctx.tenant.role, ctx.tenant.orgType);
        }),

    /**
     * Files a load. Its own truck, or a partner's; for somebody, or for the
     * company itself. It starts in procurement unless the caller says it is
     * already quoted, agreed, booked or at the loading site — whatever the
     * load is missing at that status is flagged on its first trail line
     * rather than refused, and "already at the loading site" is the one that
     * spends a tracked movement.
     *
     * Unless the company is a client, its own trucks are only ever put on its
     * clients' orders: a transporter's own-fleet row is created by accepting
     * an offer (offer.ts respondToOffer), never filed by hand.
     */
    create: tenantProcedure
        .input(CreateMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string }> => {
            const tenantId = ctx.tenant.organizationId;
            const partner = input.execution === "partner";

            assertCan(ctx.tenant.role, partner ? "order" : "trip", "create");

            if (!partner && ctx.tenant.orgType === "carrier") {
                throw new TRPCError({ code: "FORBIDDEN", message: "OWN_TRIPS_COME_FROM_CLIENTS" });
            }

            if (!partner && (input.carrierOrgId || input.carrierName || input.buy)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "OWN_FLEET_HAS_NO_CARRIER" });
            }

            // Appload moves loads; it never orders one from a company here
            if (isApploadOrg(input.clientOrgId)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "APPLOAD_NOT_A_CLIENT" });
            }

            if (input.clientOrgId && !(await isConnected(ctx.db, tenantId, input.clientOrgId))) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
            }

            if (partner && input.carrierOrgId) {
                await assertExecutor(ctx.db, tenantId, input.carrierOrgId);
            }

            const executorOnPortal = partner && await isOnPortal(ctx.db, input.carrierOrgId ?? null);

            // A partner on the portal names its own driver, in its own row
            if (executorOnPortal && hasRigInput(input)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "RIG_IS_THE_PARTNERS" });
            }

            // ...and is asked, never scheduled on its behalf
            if (executorOnPortal && input.status !== "procurement") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
            }

            const rig = await resolveRig(ctx.db, tenantId, input);
            const filedAt = new Date();

            const values: Omit<CreateMovement, "reference" | "requestReference"> = {
                organizationId: tenantId,
                execution: input.execution,
                status: input.status,
                origin: input.origin,
                destination: input.destination,
                route: input.route,
                cargoDescription: input.cargoDescription || null,
                category: input.category ?? null,
                weight: decimal(input.weight),
                weightUnit: input.weightUnit ?? null,
                expectedLoadingDate: input.expectedLoadingDate ?? null,
                expectedDeliveryAt: input.expectedDeliveryAt ?? null,
                clientOrgId: input.clientOrgId ?? null,
                clientName: input.clientOrgId ? null : input.clientName || null,
                clientReference: input.clientReference || null,
                carrierOrgId: partner ? input.carrierOrgId ?? null : null,
                carrierName: partner && !input.carrierOrgId ? input.carrierName || null : null,
                driverName: input.driverName || null,
                driverPhone: input.driverPhone ?? null,
                truckPlate: input.truckPlate || null,
                ...rig,
                ...legColumns("sell", input.sell ?? null),
                ...(partner ? legColumns("buy", input.buy ?? null) : {}),
                notes: input.notes || null,
                createdBy: ctx.tenant.userId,
            };

            // A load filed with gaps is filed anyway; what it was missing on
            // the day goes on the trail beside who filed it
            const flags = movementFlags(
                {
                    execution: input.execution,
                    status: input.status,
                    driverName: values.driverName ?? null,
                    driverPhone: values.driverPhone ?? null,
                    carrierOrgId: values.carrierOrgId ?? null,
                    carrierName: values.carrierName ?? null,
                    buyTotal: values.buyTotal ?? null,
                    buyCurrency: values.buyCurrency ?? null,
                    sellSettled: true,
                    buySettled: true,
                    // Nobody can have disputed a load that does not exist yet
                    disputeOpen: false,
                    linked: false,
                    truckPlate: values.truckPlate ?? null,
                    // A load being filed has no papers on it yet, photos included
                    unapprovedPhotos: 0,
                    resumeStatus: null,
                },
                input.status,
            );

            const starts = entersInProgress(null, input.status);

            if (starts) await assertTrackingAllowance(ctx.db, tenantId);

            // What the company will call this load (refs.ts). A load it moves
            // itself is an order from the start; one it is placing with a
            // partner is a request until somebody commits to it — unless it is
            // filed already committed, which takes both numbers at once.
            // Minted last, so the only thing that can still fail after a number
            // is taken out of the company's books is the insert itself
            const partnerRequest = partner ? await nextReference(ctx.db, tenantId, "REQ", filedAt) : null;
            const orderReference = !partner || needsOrderReference(input.status)
                ? await nextReference(ctx.db, tenantId, "ORD", filedAt)
                : null;

            const [created] = await ctx.db
                .insert(movement)
                .values({
                    ...values,
                    reference: orderReference,
                    requestReference: partnerRequest,
                    ...statusStamps(null, input.status, filedAt),
                })
                .returning();

            if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

            await recordEvent(ctx.db, {
                movementId: created.id,
                kind: "status",
                actor: actorOf(ctx.tenant),
                toStatus: created.status,
                metadata: { action: "created", ...(flags.length > 0 && { flags: flags.join(",") }) },
            });

            if (starts) {
                await recordTrackingUsage(ctx.db, {
                    organizationIds: [tenantId],
                    entityType: "movement",
                    entityId: created.id,
                });

                await announce(ctx.db, created, { from: null, actorOrgId: tenantId, notifyOwner: false, notifyExecutor: false });
            }

            return { id: created.id, ref: movementRef(created) };
        }),

    /**
     * Corrects a load. Which blocks may still change depends on where it is
     * and who else agreed to it (policy.ts); a block the caller may not write
     * is refused outright rather than quietly dropped, so a form that thinks
     * it saved something always did.
     */
    update: tenantProcedure
        .input(UpdateMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwn(ctx.db, input.id, tenantId);

            assertCan(ctx.tenant.role, writeResource(row), "update");

            if (row.version !== input.expectedVersion) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            const partner = row.execution === "partner";
            // The partner after this patch: a named organization, a typed name
            // (which is no organization at all), or whoever was there before
            const nextCarrierOrgId = input.carrierOrgId !== undefined
                ? input.carrierOrgId
                : input.carrierName ? null : row.carrierOrgId;

            const [hasParent, onPortalNow, executorOnPortal, dispute] = await Promise.all([
                hasParentRow(ctx.db, row.id),
                partner ? isOnPortal(ctx.db, row.carrierOrgId) : Promise.resolve(false),
                partner ? isOnPortal(ctx.db, nextCarrierOrgId) : Promise.resolve(false),
                // A dispute anywhere on the chain holds this row's client
                activeDisputeFor(ctx.db, row.id),
            ]);

            // What may change is judged on the load as it stands now; what the
            // rig rules are, on the partner it will have
            const groups = editableGroups({
                execution: row.execution,
                status: row.status,
                linked: row.executionMovementId !== null,
                hasParent,
                executorOnPortal: onPortalNow,
                disputeOpen: dispute !== null,
                apploadLinked: row.orderId !== null,
            });

            const touched = (Object.keys(input) as (keyof UpdateMovementInput)[])
                .filter((key) => input[key] !== undefined && FIELD_GROUP[key]);

            for (const key of touched) {
                if (!groups.includes(FIELD_GROUP[key]!)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "FIELD_LOCKED" });
                }
            }

            if (!partner && (input.carrierOrgId || input.carrierName || input.buy)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "OWN_FLEET_HAS_NO_CARRIER" });
            }

            // Who the partner is changes only before anybody was asked:
            // swapping it on a scheduled load would leave an order half
            // placed with one company and half with another. A quote set by
            // hand asked nobody on the portal, and the change below takes it
            // back to procurement
            if ((input.carrierOrgId !== undefined || input.carrierName !== undefined)
                && row.status !== "procurement" && row.status !== "prospect" && row.status !== "declined") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "FIELD_LOCKED" });
            }

            if (input.carrierOrgId) {
                await assertExecutor(ctx.db, tenantId, input.carrierOrgId);
            }

            if (isApploadOrg(input.clientOrgId)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "APPLOAD_NOT_A_CLIENT" });
            }

            if (input.clientOrgId && !(await isConnected(ctx.db, tenantId, input.clientOrgId))) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
            }

            if (executorOnPortal && hasRigInput(input)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "RIG_IS_THE_PARTNERS" });
            }

            const patch: Partial<CreateMovement> = {};
            const set = <K extends keyof CreateMovement>(key: K, value: CreateMovement[K] | undefined) => {
                if (value !== undefined) patch[key] = value;
            };

            set("origin", input.origin);
            set("destination", input.destination);
            set("route", input.route);
            set("cargoDescription", input.cargoDescription === undefined ? undefined : input.cargoDescription || null);
            set("category", input.category);
            set("weight", input.weight === undefined ? undefined : decimal(input.weight));
            set("weightUnit", input.weightUnit);
            set("expectedLoadingDate", input.expectedLoadingDate);
            set("expectedDeliveryAt", input.expectedDeliveryAt);
            set("clientOrgId", input.clientOrgId);
            set("clientName", input.clientName === undefined ? undefined : input.clientName || null);
            set("clientReference", input.clientReference === undefined ? undefined : input.clientReference || null);
            set("carrierOrgId", input.carrierOrgId);
            set("carrierName", input.carrierName === undefined ? undefined : input.carrierName || null);
            set("driverName", input.driverName === undefined ? undefined : input.driverName || null);
            set("driverPhone", input.driverPhone);
            set("truckPlate", input.truckPlate === undefined ? undefined : input.truckPlate || null);
            set("notes", input.notes === undefined ? undefined : input.notes || null);

            // A named organization and a typed name are the same slot
            if (input.clientOrgId) patch.clientName = null;
            if (input.clientName) patch.clientOrgId = null;
            if (input.carrierOrgId) patch.carrierName = null;
            if (input.carrierName) patch.carrierOrgId = null;

            // A different partner starts a different deal. Whatever was
            // offered, answered, invoiced or paid was between the owner and
            // the previous one — it stays on the owner's trail, and none of it
            // carries over to the next company, which would otherwise read
            // another carrier's answer and what the owner paid it
            const carrierChanged =
                (input.carrierOrgId !== undefined && input.carrierOrgId !== row.carrierOrgId)
                || (input.carrierName !== undefined && (input.carrierName || null) !== row.carrierName);

            if (carrierChanged) {
                if (Number(row.buyPaidAmount ?? 0) > 0) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LEG_HAS_PAYMENTS" });
                }

                Object.assign(patch, {
                    status: "procurement" as const,
                    offeredAt: null,
                    respondedAt: null,
                    responseNote: null,
                    buyInvoiceNumber: null,
                    buyInvoiceDate: null,
                    buyPaidAmount: null,
                    buySettledAt: null,
                    buySettlement: row.buyTotal !== null ? ("pending" as const) : null,
                });

                // A partner on the portal names its own driver; the one the
                // owner was told about for the previous partner is not it
                if (executorOnPortal) {
                    Object.assign(patch, {
                        driverName: null, driverPhone: null, driverId: null,
                        truckPlate: null, truckId: null, trailerId: null, linkId: null,
                    });
                }
            }

            for (const key of ["driverId", "truckId", "trailerId", "linkId"] as const) {
                if (input[key] === null) patch[key] = null;
            }

            Object.assign(patch, await resolveRig(ctx.db, tenantId, {
                driverId: input.driverId,
                truckId: input.truckId,
                trailerId: input.trailerId,
                linkId: input.linkId,
            }));

            // Re-pricing a leg keeps what has already moved against it: the
            // settlement is re-derived from the running total rather than
            // reset, and a leg with money on it can be neither cleared nor
            // moved to another currency — the amount received or paid would
            // otherwise be read against a figure it was never measured in
            for (const side of ["sell", "buy"] as const) {
                const next = input[side];
                if (next === undefined) continue;

                const moved = Number((side === "sell" ? row.sellReceivedAmount : row.buyPaidAmount) ?? 0);
                const currency = side === "sell" ? row.sellCurrency : row.buyCurrency;

                if (moved > 0 && (next === null || next.currency !== currency)) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LEG_HAS_PAYMENTS" });
                }

                Object.assign(patch, legColumns(side, next));

                if (next) {
                    const settlement = settlementStatus(next.total, moved);
                    const settledAt = settlement === "completed"
                        ? (side === "sell" ? row.sellSettledAt : row.buySettledAt) ?? new Date()
                        : null;

                    Object.assign(patch, side === "sell"
                        ? { sellSettlement: settlement, sellSettledAt: settledAt }
                        : { buySettlement: settlement, buySettledAt: settledAt });
                }
            }
            if (input.sellInvoice) {
                set("sellInvoiceNumber", input.sellInvoice.invoiceNumber || null);
                set("sellInvoiceDate", input.sellInvoice.invoiceDate ?? null);
            }
            if (input.buyInvoice) {
                set("buyInvoiceNumber", input.buyInvoice.invoiceNumber || null);
                set("buyInvoiceDate", input.buyInvoice.invoiceDate ?? null);
            }

            if (Object.keys(patch).length === 0) return { id: row.id, version: row.version };

            const [updated] = await ctx.db
                .update(movement)
                .set({ ...patch, version: sql`${movement.version} + 1` })
                .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
                .returning({ id: movement.id, version: movement.version });

            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

            await recordEvent(ctx.db, {
                movementId: row.id,
                kind: "update",
                actor: actorOf(ctx.tenant),
                // Which blocks changed, never their values: the trail is read
                // by whoever else is on the load
                metadata: {
                    action: "updated",
                    groups: [...new Set(touched.map((key) => FIELD_GROUP[key]))].join(","),
                },
            });

            return updated;
        }),

    /** Moves a load the owner may move (status.ts decides which). */
    transition: tenantProcedure
        .input(TransitionMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; status: Movement["status"]; version: number }> => {
            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);
            assertCan(ctx.tenant.role, writeResource(row), "update");

            // Placing a partner load takes the role an offer takes, and calling
            // one off the role that cancels orders (the buttons ask the same)
            const needs = row.execution === "partner" ? partnerMoveNeeds(row.status, input.to) : null;
            if (needs) assertCan(ctx.tenant.role, "order", needs);

            const updated = await transitionMovement(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, status: updated.status, version: updated.version };
        }),

    /**
     * Places a load with a partner that can answer on the portal — or with
     * Appload, which answers by taking the load on as an order of its own
     * (appload/link.ts) while this company keeps its row.
     */
    offer: tenantProcedure
        .input(OfferMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "create");

            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);

            const updated = isApploadOrg(row.carrierOrgId)
                ? await offerToAppload(ctx.db, actorOf(ctx.tenant), input)
                : await offerMovement(ctx.db, actorOf(ctx.tenant), input);

            return { id: updated.id, version: updated.version };
        }),

    /** Takes an unanswered offer back. */
    withdraw: tenantProcedure
        .input(WithdrawOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "update");
            const updated = await withdrawOffer(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, version: updated.version };
        }),

    /**
     * The executor's answer to an offer. A yes creates the executor's own
     * row — its reference is what comes back, since that is where the
     * executor works the load from now on.
     */
    respond: tenantProcedure
        .input(RespondOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string | null }> => {
            assertCan(ctx.tenant.role, "offer", "update");
            const result = await respondToOffer(ctx.db, actorOf(ctx.tenant), input);
            return { id: result.executorMovementId ?? result.movement.id, ref: result.executorRef };
        }),

    /**
     * Hands an own-fleet load to a partner, or takes a partner's back
     * in-house — the latter only for a client: a transporter's own trucks
     * come from its clients' orders (see `create`), and the button is not
     * drawn for it either (projection.ts canConvert).
     */
    convert: tenantProcedure
        .input(ConvertMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "create");

            if (input.to === "own-fleet" && ctx.tenant.orgType === "carrier") {
                throw new TRPCError({ code: "FORBIDDEN", message: "OWN_TRIPS_COME_FROM_CLIENTS" });
            }

            const updated = await convertMovement(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, ref: movementRef(updated), version: updated.version };
        }),

    /**
     * Money moved against one leg — received from the client, or paid to the
     * partner. Each payment is a line on the trail (owner-only, like every
     * money line); the row keeps the running total and derives the leg's
     * settlement from it with the same thresholds the order legs use.
     */
    recordPayment: tenantProcedure
        .input(RecordPaymentBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);
            assertCan(ctx.tenant.role, "order", "update");

            if (row.version !== input.expectedVersion) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            const sell = input.leg === "sell";
            const total = sell ? row.sellTotal : row.buyTotal;

            if (total === null || (!sell && row.execution !== "partner")) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SUCH_LEG" });
            }

            if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });

            // A negative amount corrects a payment typed wrong. It is a line of
            // its own on the trail rather than an edit of the earlier one, so
            // the books still show what was entered and what fixed it — and it
            // needs a reference saying why, and cannot take the leg below zero
            if (input.amount < 0 && !input.reference?.trim()) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "CORRECTION_NEEDS_REFERENCE" });
            }

            const settled = Math.round((Number((sell ? row.sellReceivedAmount : row.buyPaidAmount) ?? 0) + input.amount) * 100) / 100;

            if (settled < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "PAYMENT_BELOW_ZERO" });
            const status = settlementStatus(Number(total), settled);
            const paidAt = input.paidAt ?? new Date();

            const [updated] = await ctx.db
                .update(movement)
                .set({
                    ...(sell
                        ? { sellReceivedAmount: String(settled), sellSettlement: status, sellSettledAt: status === "completed" ? paidAt : null }
                        : { buyPaidAmount: String(settled), buySettlement: status, buySettledAt: status === "completed" ? paidAt : null }),
                    version: sql`${movement.version} + 1`,
                })
                .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
                .returning({ id: movement.id, version: movement.version });

            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

            await recordEvent(ctx.db, {
                movementId: row.id,
                kind: "money",
                actor: actorOf(ctx.tenant),
                note: input.reference,
                metadata: {
                    action: input.amount < 0 ? "corrected" : sell ? "received" : "paid",
                    leg: input.leg,
                    amount: input.amount,
                    paidAt: paidAt.toISOString(),
                },
            });

            return updated;
        }),

    costs: createTRPCRouter({
        /** What the load cost to run, one line at a time. Owner only, always. */
        add: tenantProcedure
            .input(AddCostBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const row = await loadOwn(ctx.db, input.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "trip", "update");

                if (row.status === "closed" || row.status === "cancelled") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "MOVEMENT_CLOSED" });
                }

                const [created] = await ctx.db
                    .insert(movementCost)
                    .values({
                        movementId: row.id,
                        kind: input.kind,
                        description: input.description || null,
                        amount: String(Math.round(input.amount * 100) / 100),
                        currency: input.currency,
                        incurredAt: input.incurredAt ?? new Date(),
                        rechargeable: input.rechargeable,
                        createdBy: ctx.tenant.userId,
                    })
                    .returning({ id: movementCost.id });

                if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

                await recordEvent(ctx.db, {
                    movementId: row.id,
                    kind: "cost",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "added", kind: input.kind, amount: input.amount, currency: input.currency },
                });

                return created;
            }),

        /**
         * Takes a cost line out of the totals. Soft: a line somebody already
         * reconciled does not vanish, it is marked as withdrawn.
         */
        remove: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const [cost] = await ctx.db
                    .select({ id: movementCost.id, movementId: movementCost.movementId, status: movement.status })
                    .from(movementCost)
                    .innerJoin(movement, eq(movement.id, movementCost.movementId))
                    .where(and(
                        eq(movementCost.id, input.id),
                        eq(movement.organizationId, ctx.tenant.organizationId),
                        sql`${movementCost.deletedAt} is null`,
                    ))
                    .limit(1);

                if (!cost) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                assertCan(ctx.tenant.role, "trip", "update");

                // Closed books stay closed — the same guard adding a line has
                if (cost.status === "closed" || cost.status === "cancelled") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "MOVEMENT_CLOSED" });
                }

                await ctx.db
                    .update(movementCost)
                    .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId })
                    .where(eq(movementCost.id, cost.id));

                await recordEvent(ctx.db, {
                    movementId: cost.movementId,
                    kind: "cost",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "removed" },
                });

                return { id: cost.id };
            }),
    }),

    documents: createTRPCRouter({
        /**
         * Files a paper against the load. The owner writes; the leg decides
         * who else reads it — a POD (no leg) is everybody's on the load, a
         * sell-leg invoice is the owner's and its client's, a buy-leg receipt
         * the owner's and its partner's.
         *
         * A loading photo is one of the load's own: it is what went on the
         * truck, not a paper between two of the companies, so it never carries
         * a leg. The server cannot see what was actually uploaded — only the
         * URL the bucket returned — so an image is expected and not enforced.
         */
        add: tenantProcedure
            .input(AddMovementDocumentBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const row = await loadOwn(ctx.db, input.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "document", "upload");
                assertEdgeStoreUrl(input.url);

                if (input.leg === "buy" && row.execution !== "partner") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SUCH_LEG" });
                }

                if (input.type === "loading-photo" && input.leg) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SUCH_LEG" });
                }

                if (input.costId) {
                    const [cost] = await ctx.db
                        .select({ id: movementCost.id })
                        .from(movementCost)
                        .where(and(eq(movementCost.id, input.costId), eq(movementCost.movementId, row.id)))
                        .limit(1);

                    if (!cost) throw new TRPCError({ code: "BAD_REQUEST", message: "COST_NOT_FOUND" });
                }

                const [created] = await ctx.db
                    .insert(movementDocument)
                    .values({
                        movementId: row.id,
                        type: input.type,
                        leg: input.leg ?? null,
                        title: input.title || null,
                        url: input.url,
                        size: input.size ?? null,
                        mimeType: input.mimeType || null,
                        costId: input.costId ?? null,
                        uploadedBy: ctx.tenant.userId,
                    })
                    .returning({ id: movementDocument.id });

                if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

                await recordEvent(ctx.db, {
                    movementId: row.id,
                    kind: "document",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "added", type: input.type, leg: input.leg ?? null },
                });

                // The company on the other side of that paper hears about it —
                // for a buy-leg paper, only a partner actually on the load: one
                // merely named in procurement, or asked and then withdrawn from,
                // cannot open the row, and telling it the row exists is a leak.
                // A loading photo tells nobody anything: it is the load's own,
                // the keeper files a whole round of them at once, and they are
                // already on the row for anyone who opens it
                const recipient = input.type === "loading-photo"
                    ? null
                    : input.leg === "buy"
                        ? (row.carrierOrgId && isExecutorOf(row, row.carrierOrgId) ? row.carrierOrgId : null)
                        : row.clientOrgId;

                if (recipient) {
                    await notify(ctx.db, {
                        organizationId: recipient,
                        kind: "movement.document",
                        email: false,
                        entityType: "movement",
                        entityId: row.id,
                        params: { ref: movementRef(row), type: input.type },
                    });
                }

                return created;
            }),

        /**
         * Validates one loading photo: the manager saying that what the
         * warehouse photographed is what the load is. Approving is above the
         * role that uploads, and it is the load's own company that does it —
         * the row this document hangs on is the one holding the truck.
         *
         * Nothing about the load moves here. The truck may still leave with
         * photos nobody looked at; that is the PHOTOS_UNAPPROVED flag on the
         * status event (status.ts), which records who sent it out that way.
         */
        approve: tenantProcedure
            .input(ApproveMovementDocumentBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const [document] = await ctx.db
                    .select({
                        id: movementDocument.id,
                        movementId: movementDocument.movementId,
                        type: movementDocument.type,
                    })
                    .from(movementDocument)
                    .where(and(eq(movementDocument.id, input.id), sql`${movementDocument.deletedAt} is null`))
                    .limit(1);

                if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                // The row that holds the truck, and this company's own: a
                // stranger asking gets the same 404 the load itself gives
                await loadOwn(ctx.db, document.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "document", "approve");

                if (document.type !== "loading-photo") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_APPROVABLE" });
                }

                // Only ever the first approval, so two managers clicking at
                // once leaves one trail line rather than two
                const [approved] = await ctx.db
                    .update(movementDocument)
                    .set({ approvedAt: new Date(), approvedBy: ctx.tenant.userId })
                    .where(and(eq(movementDocument.id, document.id), sql`${movementDocument.approvedAt} is null`))
                    .returning({ id: movementDocument.id });

                if (!approved) throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_APPROVABLE" });

                await recordEvent(ctx.db, {
                    movementId: document.movementId,
                    kind: "document",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "approved", type: "loading-photo" },
                });

                return { id: document.id };
            }),

        remove: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const [document] = await ctx.db
                    .select({ id: movementDocument.id, movementId: movementDocument.movementId })
                    .from(movementDocument)
                    .innerJoin(movement, eq(movement.id, movementDocument.movementId))
                    .where(and(
                        eq(movementDocument.id, input.id),
                        eq(movement.organizationId, ctx.tenant.organizationId),
                        sql`${movementDocument.deletedAt} is null`,
                    ))
                    .limit(1);

                if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                assertCan(ctx.tenant.role, "document", "upload");

                await ctx.db
                    .update(movementDocument)
                    .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId })
                    .where(eq(movementDocument.id, document.id));

                await recordEvent(ctx.db, {
                    movementId: document.movementId,
                    kind: "document",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "removed" },
                });

                return { id: document.id };
            }),
    }),

    disputes: createTRPCRouter({
        /**
         * Says something went wrong with the load — theft, loss, damage or
         * anything else. Any company on it may, at any role: the dispute
         * covers the load in every company's books up and down its chain,
         * bar the rows an earlier dispute already holds (disputes.ts), and
         * until the company that opened it resolves it none of the companies
         * it covers can close theirs. Refused while the load is still only
         * being asked about, and once it is over — the same line the button
         * is drawn on.
         */
        open: tenantProcedure
            .input(OpenDisputeBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const { row } = await loadVisible(ctx.db, input.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "dispute", "open");

                // The door refuses a load still being asked about; a load that
                // is over has no books left for a dispute to hold open
                if (isTerminal(row.status)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_INVALID_LOAD" });
                }

                const { dispute, rowIds } = await openDispute(ctx.db, actorOf(ctx.tenant), input);

                await recordEvent(ctx.db, {
                    movementId: dispute.movementId,
                    kind: "dispute",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "opened", disputeId: dispute.id, reason: dispute.reason },
                });

                await announceDispute(ctx.db, "movement.dispute-opened", dispute, rowIds, ctx.tenant.organizationId);

                return { id: dispute.id };
            }),

        /**
         * Declares a dispute settled, with the note that says how. Only the
         * company that opened it, and above the plain member's role: it
         * releases every company's books on the load at once.
         */
        resolve: tenantProcedure
            .input(ResolveDisputeBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                assertCan(ctx.tenant.role, "dispute", "resolve");

                const { dispute, rowIds } = await resolveDispute(ctx.db, actorOf(ctx.tenant), input);

                await recordEvent(ctx.db, {
                    movementId: dispute.movementId,
                    kind: "dispute",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "resolved", disputeId: dispute.id, reason: dispute.reason },
                });

                await announceDispute(ctx.db, "movement.dispute-resolved", dispute, rowIds, ctx.tenant.organizationId);

                return { id: dispute.id };
            }),
    }),

    /**
     * Emails the partner the confirmation of the load it was given: the
     * transport-order template, filled and uploaded by the browser before it
     * reaches here, attached to a message in the company's own name.
     *
     * The document is filed on the load as a buy-leg paper on the way out, so
     * what was sent stays readable by both sides afterwards — the confirmation
     * is the agreement, and neither company should have to go back to an inbox
     * to find out what it says.
     */
    sendConfirmation: tenantProcedure
        .input(SendConfirmationBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; simulated: boolean }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwn(ctx.db, input.id, tenantId);
            assertCan(ctx.tenant.role, "document", "upload");
            assertConfirmationUrl(input.url, row.id);

            // Only an order has a partner to confirm anything to
            if (row.execution !== "partner") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_A_PARTNER_LOAD" });
            }

            // The menu offers this from the moment the load is placed until the
            // truck arrives, and the server holds the same line rather than
            // trusting it — anything else is a send out of Appload's domain on
            // a row that has no confirmation to make.
            if (row.status !== "scheduled" && row.status !== "booked" && !isInProgress(row.status)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_SENDABLE" });
            }

            // Metered like the location request, and for the same reason: the
            // recipient is typed by the caller and the mail leaves under
            // Appload's verified sender. Per load first, so one impatient user
            // cannot spend the company's standing on a single partner.
            const allowed =
                await withinRateLimit(ctx.db, { key: `confirmation:load:${row.id}`, windowMs: 60 * 60 * 1000, max: 3 })
                && await withinRateLimit(ctx.db, { key: `confirmation:org:${tenantId}`, windowMs: 24 * 60 * 60 * 1000, max: 30 });

            if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });

            const ref = movementRef(row);
            const names = await loadNames(ctx.db, [row.organizationId]);
            const tenantName = names.get(row.organizationId) ?? "";

            const response = await fetch(input.url);

            if (!response.ok) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
            }

            const content = Buffer.from(await response.arrayBuffer()).toString("base64");

            const result = await sendEmail({
                to: [input.to],
                cc: input.cc,
                subject: `Confirmação de carga ${ref} · ${tenantName}`,
                html: brandedEmail({
                    locale: "pt",
                    title: `Confirmação de carga ${ref}`,
                    lines: [input.message || `Segue em anexo a confirmação da carga ${ref}.`],
                    // The attachment is the document; the link is the same
                    // file, for a mail client that strips attachments
                    ctaLabel: "Abrir a confirmação",
                    ctaUrl: input.url,
                    disclaimer: `Este email foi enviado por ${tenantName} através do Appload Enterprise.`,
                }),
                attachments: [{ filename: input.filename, content }],
            });

            if (!result.ok) {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "EMAIL_FAILED", cause: new Error(result.error) });
            }

            const [created] = await ctx.db
                .insert(movementDocument)
                .values({
                    movementId: row.id,
                    type: "transport-order",
                    leg: "buy",
                    title: input.filename,
                    url: input.url,
                    mimeType: "application/pdf",
                    uploadedBy: ctx.tenant.userId,
                })
                .returning({ id: movementDocument.id });

            if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

            await recordEvent(ctx.db, {
                movementId: row.id,
                kind: "document",
                actor: actorOf(ctx.tenant),
                metadata: { action: "sent", type: "transport-order", sentTo: input.to },
            });

            // Only a partner actually on the load hears about it, the same
            // rule a buy-leg paper filed by hand goes out under
            const recipient = row.carrierOrgId && isExecutorOf(row, row.carrierOrgId) ? row.carrierOrgId : null;

            if (recipient) {
                await notify(ctx.db, {
                    organizationId: recipient,
                    kind: "movement.document",
                    email: false,
                    entityType: "movement",
                    entityId: row.id,
                    params: { ref, type: "transport-order" },
                });
            }

            return { id: created.id, simulated: result.simulated };
        }),

    /**
     * Every position reported for the load, oldest first. A linked order
     * reads the trail of the row with the truck — the positions and nothing
     * else of it: a ping is coordinates and a place name, with no company,
     * no price and no phone on it.
     */
    trail: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TrailPoint[]> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            const trailId = row.executionMovementId ? await terminalMovementId(ctx.db, row.id) : row.id;

            const points = await ctx.db
                .select({
                    id: movementLocation.id,
                    latitude: movementLocation.latitude,
                    longitude: movementLocation.longitude,
                    placeName: movementLocation.placeName,
                    placeLabel: movementLocation.placeLabel,
                    recordedAt: movementLocation.recordedAt,
                    source: movementLocation.source,
                })
                .from(movementLocation)
                .where(eq(movementLocation.movementId, trailId))
                .orderBy(asc(movementLocation.recordedAt));

            return points.map((point) => ({
                id: point.id,
                lat: num(point.latitude),
                lng: num(point.longitude),
                placeName: point.placeName,
                placeLabel: point.placeLabel,
                recordedAt: point.recordedAt,
                source: trailSource(point.source),
                picked: point.placeName !== null,
            }));
        }),

    /**
     * What has been said to this load's driver on WhatsApp, oldest last-100
     * first. Read-only: the asking is the tracking card's button above, the
     * answering happens in WhatsApp, and the admin webhook files both.
     *
     * A thread hangs off the driver's phone number, not off the load, so only
     * the row that holds the truck reads one — a linked order's driver is the
     * executor's to talk to, and its number is not shown here either.
     *
     * Two things keep a number typed here from becoming a window on somebody
     * else's exchange. The thread is taken from `conversationId`, which only
     * this row's own asking — the button below, or the tracking cron on it —
     * ever stamps: a phone number is free-form tenant input, `chat_conversation`
     * is one row per number for the whole platform, and matching on the digits
     * alone would hand over another company's driver, or ops' own, to whoever
     * typed the number. And the reading starts at `startedAt`, because the same
     * owner-driver runs for more than one company over their life and the load
     * references, plates and lanes in those messages are each asker's business:
     * what was said before this load started was not said about it.
     */
    thread: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<MovementThreadItem[]> => {
            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);
            assertCan(ctx.tenant.role, "trip", "read");

            if (row.executionMovementId || !row.conversationId || !row.startedAt) return [];

            const messages = await ctx.db
                .select({
                    id: chatMessage.id,
                    direction: chatMessage.direction,
                    body: chatMessage.body,
                    status: chatMessage.status,
                    createdAt: chatMessage.createdAt,
                })
                .from(chatMessage)
                .where(and(
                    eq(chatMessage.conversationId, row.conversationId),
                    gte(chatMessage.createdAt, row.startedAt),
                ))
                .orderBy(desc(chatMessage.createdAt))
                .limit(100);

            return messages.reverse();
        }),

    /**
     * The loads whose driver conversation this company may read, newest start
     * first — what the Chats page lists under Drivers.
     *
     * The same four safeguards the per-load read above turns on, as a filter:
     * the row is the tenant's own, it is the one holding the truck rather
     * than a subcontract's upper half or an Appload order's mirror, its own
     * asking stamped the conversation, and the load has actually started. A
     * row that fails any of them has no thread to read, so it has no line
     * here either.
     */
    threadList: tenantProcedure
        .query(async ({ ctx }): Promise<MovementThreadLoad[]> => {
            assertCan(ctx.tenant.role, "trip", "read");

            const rows = await ctx.db
                .select({
                    id: movement.id,
                    reference: movement.reference,
                    requestReference: movement.requestReference,
                    clientReference: movement.clientReference,
                    driverName: movement.driverName,
                    status: movement.status,
                })
                .from(movement)
                .where(and(
                    eq(movement.organizationId, ctx.tenant.organizationId),
                    isNull(movement.executionMovementId),
                    isNull(movement.orderId),
                    isNotNull(movement.conversationId),
                    isNotNull(movement.startedAt),
                ))
                .orderBy(desc(movement.startedAt))
                .limit(100);

            return rows.map((row) => ({
                id: row.id,
                ref: movementRef(row),
                driverName: row.driverName,
                status: row.status,
            }));
        }),

    /**
     * The drawn road route for the load, cached in `movement_route` under the
     * same rules as an order's: recomputed when either endpoint changed or a
     * geocode-only answer went stale, a compute failure falls back to what is
     * cached, and a failure with nothing cached is remembered for a quarter
     * of an hour so a lane Google cannot resolve is not re-bought on every
     * open. A linked order draws its own cache — same lane, same endpoints —
     * rather than reaching into the executor's row.
     */
    route: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderRouteDto> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            // The map contract names its subject `orderId`; the load's own
            // reference is what goes in it, and nothing reads it but a label
            const ref = movementRef(row);

            const [cached] = await ctx.db
                .select()
                .from(movementRoute)
                .where(eq(movementRoute.movementId, row.id))
                .limit(1);

            const fresh = cached
                && cached.originPlaceId === cacheKey(row.origin)
                && cached.destinationPlaceId === cacheKey(row.destination)
                && (cached.source === "routes" || Date.now() - cached.computedAt.getTime() < GEOCODE_TTL_MS);

            if (cached && fresh) return toRouteDto(ref, cached);

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

            const [saved] = await ctx.db
                .insert(movementRoute)
                .values(values)
                .onConflictDoUpdate({ target: movementRoute.movementId, set: refresh })
                .returning();

            if (!saved) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

            return toRouteDto(ref, saved);
        }),

    /**
     * Asks the driver where they are, now, outside the twice-daily rounds —
     * the owner's own driver, or the off-platform partner's it was given.
     * Never a linked load's: that driver is the executor's to ask.
     *
     * Metered, like it always was: nothing ties a typed phone number to the
     * tenant that typed it, so an unbounded button here is a billed WhatsApp
     * send from Appload's sender to any number somebody cares to name.
     */
    requestLocation: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ sent: boolean; mode: "native" | "template" }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwn(ctx.db, input.id, tenantId);
            assertCan(ctx.tenant.role, "trip", "update");

            // A driver is only somewhere worth asking about while the load is in
            // progress — booked, nobody has gone to it yet; delivered, the
            // position is somebody else's next job. Nor a load on an Appload
            // order: that truck is asked from the order, and answers there
            if (!isInProgress(row.status) || row.executionMovementId || row.orderId !== null) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_TRACKABLE" });
            }

            const { driverName, driverPhone } = row;
            if (!driverName || !driverPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "NO_DRIVER" });

            // Per load first, so one impatient user cannot spend the whole
            // company's budget on a single driver, then per company
            const allowed =
                await withinRateLimit(ctx.db, { key: `trip-ping:trip:${row.id}`, windowMs: 60 * 60 * 1000, max: 3 })
                && await withinRateLimit(ctx.db, { key: `trip-ping:org:${tenantId}`, windowMs: 24 * 60 * 60 * 1000, max: 30 });

            if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });

            // No order id: chats point at orders, never at movements — the
            // movement holds the link, which keeps the import one-way
            const { conversation } = await startConversation(ctx.db, { driverName, driverPhone });

            if (row.conversationId !== conversation.id) {
                await ctx.db
                    .update(movement)
                    .set({ conversationId: conversation.id })
                    .where(and(eq(movement.id, row.id), eq(movement.organizationId, tenantId)));
            }

            const ref = movementRef(row);
            const origin = place(row.origin);
            const destination = place(row.destination);
            const open = await hasOpenSession(ctx.db, conversation.id);

            const body = open
                ? locationRequestText(ref, { truckPlate: row.truckPlate, origin, destination })
                : trackingTemplateText(driverName, ref, row.truckPlate ?? "—", origin, destination);

            const result = open
                ? await sendWhatsAppLocationRequest(conversation.driverPhone, body)
                : await sendWhatsAppTemplate(
                    conversation.driverPhone,
                    [driverName, ref, row.truckPlate ?? "—", origin, destination],
                    shareLocationPayload(ref),
                );

            if (!result.ok) console.error("movement location request failed:", result.error);

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

            if (!result.ok && result.error === "INFOBIP_NOT_CONFIGURED") {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "INFOBIP_NOT_CONFIGURED" });
            }

            return { sent: result.ok, mode: open ? "native" : "template" };
        }),
});
