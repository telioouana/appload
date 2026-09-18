import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { order, orderDocument, orderHistory, orderOffer } from "@workspace/db/orders";
import type { Order, OrderDocumentType } from "@workspace/db/orders";
import { orderRequest } from "@workspace/db/quotes";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { user } from "@workspace/db/users";
import { ORDER_STATUS, type TRUCK_AGE } from "@workspace/db/types";

import { linkedMovementId } from "@workspace/domain/appload/link";
import { notify } from "@workspace/domain/notifications";
import { createOrder } from "@workspace/domain/orders/create";
import { portalNextOrderId } from "@workspace/domain/orders/next-order-id";
import { currentOrderYear } from "@workspace/domain/orders/order-id";
import { CreateOrderSchemaServer } from "@workspace/domain/orders/schemas";
import { allowedForActor } from "@workspace/domain/orders/policy";
import { isDispatchMove, missingForDispatch } from "@workspace/domain/orders/dispatch-readiness";
import { loadDispatchReadiness } from "@workspace/domain/orders/dispatch-papers";
import { loadDispatchPack } from "@workspace/domain/orders/dispatch-pack";
import { LoadingCheckInputSchema, loadingMoveRequirements } from "@workspace/domain/orders/loading-check";
import { loadLoadingCheckState, openDispatchId, recordLoadingCheck } from "@workspace/domain/orders/loading-check-store";
import { ON_GOING_STATUSES, PENDING_POD_STATUSES } from "@workspace/domain/orders/status-groups";
import { allowedTransitions, transitionRequirements } from "@workspace/domain/orders/transitions";
import { applyTransition, deriveResumeStatus, liveStatus, pendingOfferCount } from "@workspace/domain/orders/transition";
import { trackingAllowance } from "@workspace/domain/subscription";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import { CancelOrderBaseSchema, CreateOrderBaseSchema, SendRequestsBaseSchema } from "@/backend/schemas/order";
import { AddDocumentBaseSchema, TransitionBaseSchema, type PartnerDocumentForm } from "@/backend/schemas/dispatch";
import {
    ORDER_SECTIONS,
    ORDER_SORTS,
    defaultSection,
    isSection,
    type LoadingCheckView,
    type OrderDetail,
    type OrderDocumentView,
    type OrderHistoryEntry,
    type OrderRequestStatus,
    type OrderRow,
    type OrderSection,
    type OrderStats,
    type PagedResult,
    type SortDir,
    type TransitionOption,
    type TransitionOptions,
} from "@/frontend/pages/orders/types";
import {
    actorOf,
    anyRequest,
    assertEdgeStoreUrl,
    assertOrgType,
    assertShipperOf,
    counterpartyNameColumn,
    isMineColumn,
    loadVisibleOrder,
    moneyColumns,
    myRequest,
    offerColumns,
    orderContext,
    orderScope,
    organizationName,
    ownsOrder,
    scopeOf,
    sideOf,
    sideScope,
    toMoney,
    toMoneyDetail,
    toNumber,
    toOfferView,
    toTRPCError,
    visibleOffers,
    visibleOrders,
    type Db,
    type TenantScope,
} from "@/frontend/pages/orders/server/projection";
import {
    assertConnectedCarriers,
    closeOrderRequests,
    listRequestViews,
    requestCount,
    withdrawApploadRequest,
    writeOrderRequests,
} from "@/frontend/pages/orders/server/requests";
import { offersRouter } from "@/frontend/pages/orders/server/offers";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/**
 * Business rule shared with Admin (`apps/admin/src/lib/fleet.ts`): trucks
 * from 2015 onwards are "recent". Copied rather than imported — the portal
 * never reaches into the other app — and it is one line.
 */
const truckAgeFromYear = (year: number | null): (typeof TRUCK_AGE)[number] | undefined =>
    year === null ? undefined : year >= 2015 ? "recent" : "not-recent";

/** The documents a partner may see on an order; everything else is Appload's. */
const PORTAL_DOCUMENT_TYPES = ["pod", "evidence", "transport-order"] as const;

/** The timeline kinds the portal renders. */
const PORTAL_HISTORY_KINDS = ["transition", "offer", "document", "dispute"] as const;

/** How far back the timeline goes in one read. */
const HISTORY_LIMIT = 100;

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const zeroCount = sql<number>`0`.mapWith(Number);

const countWhere = (predicate: SQL | undefined) =>
    predicate === undefined
        ? sql<number>`count(*)::int`.mapWith(Number)
        : sql<number>`count(*) filter (where ${predicate})::int`.mapWith(Number);

/** The driver and rig only exist once a carrier is committed. */
const hasRig = (status: Order["status"]) => status !== "prospect";

/** Closed for good: only Appload reverses these, and only from Admin. */
const TERMINAL_STATUSES: Order["status"][] = ["completed", "cancelled", "underbid"];

/** A carrier's own offer and request on a page of orders, keyed by order. */
type OwnState = {
    offers: Map<string, NonNullable<OrderRow["myOffer"]>>;
    requests: Map<string, OrderRequestStatus>;
};

const emptyOwnState = (): OwnState => ({ offers: new Map(), requests: new Map() });

const OrdersInput = z.object({
    /** The route segment; omitted means this organization type's first page */
    section: z.enum(ORDER_SECTIONS).optional(),
    search: z.string().trim().max(120).optional(),
    /** Carrier: booked orders with nobody driving them yet */
    dispatch: z.boolean().optional(),
    sort: z.enum(ORDER_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
});

type OrdersInput = z.infer<typeof OrdersInput>;

/** The section a tenant asked for, or a refusal — a carrier has no "all" page. */
function assertSection(tenant: TenantScope, section: OrderSection): OrderSection {
    if (!isSection(tenant.orgType, section)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_SECTION" });
    }

    return section;
}

// Chain position for the status sort: the vocabulary is declared in trip order
const STATUS_POSITION = sql`array_position(ARRAY[${sql.join(ORDER_STATUS.map((status) => sql`${status}`), sql`, `)}]::text[], ${order.status}::text)`;

function ordering(sort: OrdersInput["sort"], dir: SortDir): SQL[] {
    const by = (column: AnyColumn | SQL) =>
        dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;

    switch (sort) {
        case "loading": return [by(order.expectedLoadingDate), desc(order.year), desc(order.seq)];
        case "status": return [by(STATUS_POSITION), desc(order.year), desc(order.seq)];
        default: return [by(order.year), by(order.seq)];
    }
}

/**
 * The list projection. Both organization types share the key names — the
 * money columns and the counters are chosen per side — so one row type comes
 * back whichever way the query was built. A carrier is given zeros for the
 * client-side counters: how many OTHER carriers were asked, and how many
 * quoted, is not its business.
 *
 * `isMine` says whether the row is this reader's own deal, because a carrier
 * also sees the orders it was asked about and the ones it quoted for and
 * lost — where the money and the rig on the row are the WINNER's.
 */
const rowColumns = (tenant: TenantScope) => ({
    id: order.id,
    orderId: order.orderId,
    status: order.status,
    route: order.route,
    tripType: order.tripType,
    loadType: order.loadType,
    category: order.category,
    description: order.description,
    weight: order.weight,
    weightUnit: order.weightUnit,
    loadingAddress: order.loadingAddress,
    offloadingAddress: order.offloadingAddress,
    expectedLoadingDate: order.expectedLoadingDate,
    expectedOffloadingDate: order.expectedOffloadingDate,
    deliveries: order.deliveries,
    expectedTrucks: order.expectedTrucks,
    counterpartyName: counterpartyNameColumn(tenant),
    driverName: order.driverName,
    truckPlate: order.truckPlate,
    trailerPlate: order.trailerPlate,
    podStatus: order.podStatus,
    version: order.version,
    createdAt: order.createdAt,
    isMine: isMineColumn(tenant),
    ...moneyColumns(tenant),
    offersPending: tenant.orgType === "shipper" ? pendingOfferCount : zeroCount,
    requestedCount: tenant.orgType === "shipper" ? requestCount(["requested"]) : zeroCount,
    quotedCount: tenant.orgType === "shipper" ? requestCount(["quoted"]) : zeroCount,
});

/** Every condition one list read asks for, on top of the tenant predicate. */
function listWhere(input: OrdersInput & { section: OrderSection }, tenant: TenantScope): SQL | undefined {
    const conditions: (SQL | undefined)[] = [
        orderScope(input.section, tenant.organizationId, tenant.orgType),
    ];

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;

        conditions.push(or(
            ilike(order.orderId, term),
            ilike(order.description, term),
            ilike(order.truckPlate, term),
            ilike(tenant.orgType === "shipper" ? order.carrierName : order.shipperName, term),
        ));
    }

    // The "to dispatch" tile: booked, but nobody named to drive it yet
    if (input.dispatch) {
        conditions.push(and(eq(order.status, "booked"), isNull(order.driverId)));
    }

    return and(...conditions);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const documentColumns = {
    id: orderDocument.id,
    type: orderDocument.type,
    title: orderDocument.title,
    url: orderDocument.url,
    size: orderDocument.size,
    mimeType: orderDocument.mimeType,
    createdAt: orderDocument.createdAt,
    uploadedByName: user.name,
};

/** The order's own files, newest first — never the financial records. */
async function listDocumentViews(db: Db, orderPk: string): Promise<OrderDocumentView[]> {
    return db
        .select(documentColumns)
        .from(orderDocument)
        .leftJoin(user, eq(user.id, orderDocument.uploadedBy))
        .where(and(
            eq(orderDocument.orderId, orderPk),
            inArray(orderDocument.type, [...PORTAL_DOCUMENT_TYPES]),
            isNull(orderDocument.deletedAt),
        ))
        .orderBy(desc(orderDocument.createdAt));
}

/**
 * Files a document against an order and tells the other side. Shared by the
 * documents mutation and by a transition that carries its proof, so both
 * write the same row, the same history entry and the same notification.
 */
async function addOrderDocument(
    db: Db,
    params: {
        row: Pick<Order, "id" | "orderId" | "shipperId" | "carrierId">;
        tenant: TenantScope;
        document: PartnerDocumentForm;
    },
): Promise<OrderDocumentView> {
    assertEdgeStoreUrl(params.document.url);

    const [document] = await db
        .insert(orderDocument)
        .values({
            orderId: params.row.id,
            type: params.document.type,
            // Order-level, like every POD and every piece of evidence: the
            // party column belongs to the financial records
            party: null,
            title: params.document.title ?? null,
            url: params.document.url,
            size: params.document.size ?? null,
            mimeType: params.document.mimeType ?? null,
            uploadedBy: params.tenant.userId,
        })
        .returning();

    if (!document) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    }

    // A loading photo is one piece of a check, and a check is worth one
    // timeline row and one notification — written by the check itself, not
    // by each of the ten photos it may carry
    const evented = document.type !== "loading-photo";

    if (evented) {
        await db.insert(orderHistory).values({
            orderId: params.row.id,
            actorUserId: params.tenant.userId,
            kind: "document",
            metadata: { documentId: document.id, type: document.type },
        });
    }

    // The other party to the trip, read off the row: the uploader is the
    // client of the orders it filed and the carrier of the ones it drives
    const counterparty = params.row.shipperId === params.tenant.organizationId
        ? params.row.carrierId
        : params.row.shipperId;

    if (evented && counterparty) {
        await notify(db, {
            organizationId: counterparty,
            kind: "order.document",
            email: false,
            entityType: "order",
            entityId: params.row.orderId,
            params: { orderId: params.row.orderId, documentType: document.type },
        });
    }

    return {
        id: document.id,
        type: document.type,
        title: document.title,
        url: document.url,
        size: document.size,
        mimeType: document.mimeType,
        uploadedByName: null,
        createdAt: document.createdAt,
    };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ordersRouter = createTRPCRouter({
    /**
     * One page of the section. The tenant predicate and the section predicate
     * are composed server-side; a carrier's own offer and its own request
     * status are fetched for the page in one follow-up query each, because a
     * join on them would multiply rows.
     */
    list: tenantProcedure
        .input(OrdersInput)
        .query(async ({ ctx, input }): Promise<PagedResult<OrderRow>> => {
            const tenant = scopeOf(ctx.tenant);
            const section = assertSection(tenant, input.section ?? defaultSection(tenant.orgType));
            const where = listWhere({ ...input, section }, tenant);

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select(rowColumns(tenant))
                    .from(order)
                    .where(where)
                    .orderBy(...ordering(input.sort, input.dir))
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db
                    .select({ value: count() })
                    .from(order)
                    .where(where),
            ]);

            const ids = rows.map((row) => row.id);
            const own = tenant.orgType === "carrier" && ids.length > 0
                ? await loadOwnState(ctx.db, ids, tenant.organizationId)
                : emptyOwnState();

            return {
                items: rows.map((row): OrderRow => {
                    const offer = own.offers.get(row.id) ?? null;

                    return {
                        id: row.id,
                        orderId: row.orderId,
                        status: row.status,
                        route: row.route,
                        tripType: row.tripType,
                        loadType: row.loadType,
                        category: row.category,
                        description: row.description,
                        weight: Number(row.weight),
                        weightUnit: row.weightUnit,
                        loadingAddress: row.loadingAddress,
                        offloadingAddress: row.offloadingAddress,
                        expectedLoadingDate: row.expectedLoadingDate,
                        expectedOffloadingDate: row.expectedOffloadingDate,
                        deliveries: row.deliveries,
                        expectedTrucks: row.expectedTrucks,
                        counterparty: { name: row.counterpartyName },
                        money: toMoney(row),
                        myOffer: offer,
                        requestState: {
                            requested: tenant.orgType === "shipper" ? row.requestedCount : null,
                            quoted: tenant.orgType === "shipper" ? row.quotedCount : null,
                            mine: own.requests.get(row.id) ?? null,
                        },
                        offersPending: tenant.orgType === "shipper" ? row.offersPending : null,
                        // The driver and the plates on an order that went to
                        // another carrier are that carrier's, not this one's
                        dispatch: row.isMine && hasRig(row.status)
                            ? {
                                driverName: row.driverName,
                                truckPlate: row.truckPlate,
                                trailerPlate: row.trailerPlate,
                            }
                            : null,
                        podStatus: row.podStatus,
                        version: row.version,
                        createdAt: row.createdAt,
                    };
                }),
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
    stats: tenantProcedure.query(async ({ ctx }): Promise<OrderStats> => {
        const tenant = scopeOf(ctx.tenant);
        const { organizationId: tenantId, orgType } = tenant;
        const shipper = orgType === "shipper";

        // Every section is a key, so the row type stays a literal record; the
        // pages this organization type does not have simply count nothing
        const sectionSelect = Object.fromEntries(
            ORDER_SECTIONS.map((section) => [
                section,
                isSection(orgType, section) ? countWhere(orderScope(section, tenantId, orgType)) : zeroCount,
            ]),
        ) as Record<OrderSection, SQL<number>>;

        // The whole on-going section, not the cron's ping set: the tile opens
        // /orders/on-going, and a number that disagrees with the list one
        // click away is worse than a number that counts a truck still loading
        const onTheRoad = shipper
            ? inArray(order.status, ON_GOING_STATUSES)
            : and(eq(order.carrierId, tenantId), inArray(order.status, ON_GOING_STATUSES));

        const [row] = await ctx.db
            .select({
                ...sectionSelect,
                // Counted on the side the sections are counted on, so the
                // total is the sum of the lists it opens: a transporter's
                // delegated orders are worked from their load row, not here
                total: shipper ? count() : countWhere(eq(order.carrierId, tenantId)),
                // Shipper: asked and still waiting for the first answer
                awaitingOffers: shipper
                    ? countWhere(and(
                        eq(order.status, "prospect"),
                        sql`${pendingOfferCount} = 0`,
                        anyRequest(["requested"]),
                    ))
                    : zeroCount,
                offersToReview: shipper
                    ? countWhere(and(eq(order.status, "prospect"), sql`${pendingOfferCount} > 0`))
                    : zeroCount,
                newRequests: shipper ? zeroCount : countWhere(myRequest(tenantId, ["requested"])),
                toDispatch: shipper
                    ? zeroCount
                    : countWhere(and(
                        eq(order.carrierId, tenantId),
                        eq(order.status, "booked"),
                        isNull(order.driverId),
                    )),
                onTheRoad: countWhere(onTheRoad),
                deliveredPending: shipper
                    ? countWhere(and(
                        eq(order.status, "delivered"),
                        or(isNull(order.podStatus), inArray(order.podStatus, [...PENDING_POD_STATUSES])),
                    ))
                    : countWhere(and(eq(order.carrierId, tenantId), eq(order.status, "delivered"))),
            })
            .from(order)
            .where(visibleOrders(tenantId, orgType));

        const bySection = Object.fromEntries(
            ORDER_SECTIONS.map((section) => [section, Number(row?.[section] ?? 0)]),
        ) as Record<OrderSection, number>;

        return {
            total: row?.total ?? 0,
            bySection,
            attention: {
                awaitingOffers: row?.awaitingOffers ?? 0,
                offersToReview: row?.offersToReview ?? 0,
                newRequests: row?.newRequests ?? 0,
                toDispatch: row?.toDispatch ?? 0,
                onTheRoad: row?.onTheRoad ?? 0,
                deliveredPending: row?.deliveredPending ?? 0,
            },
        };
    }),

    /**
     * The detail page in one round: the order projected onto the caller's own
     * leg, the offers it may read, the request round, the files and what it
     * may do next.
     */
    get: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderDetail> => {
            const tenant = scopeOf(ctx.tenant);
            const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);
            // Which side of THIS order the caller is on: a transporter reads
            // the load it handed to Appload as that order's client
            const reader = sideScope(tenant, row);
            const carrier = reader.orgType === "carrier";
            // Reading the order is not being a party to it: a carrier that
            // was asked about it, or quoted and lost, sees the row — and
            // nothing on it that belongs to the deal somebody else got
            const isMine = ownsOrder(row, tenant);

            const [offerRows, requests, documents, linkedLoadId] = await Promise.all([
                ctx.db
                    .select(offerColumns(reader.orgType))
                    .from(orderOffer)
                    .where(visibleOffers(row.id, reader))
                    .orderBy(desc(orderOffer.createdAt)),
                listRequestViews(ctx.db, row.id, reader),
                isMine ? listDocumentViews(ctx.db, row.id) : Promise.resolve([]),
                // The caller's own load behind this order, when it keeps one.
                // Best-effort: the order page is not worth failing over a
                // link that only sends the reader somewhere nicer
                linkedMovementId(ctx.db, { orderId: row.id, organizationId: tenant.organizationId })
                    .catch((error) => {
                        console.error(`linked load for ${row.orderId} failed`, error);
                        return null;
                    }),
            ]);

            const offers = offerRows.map((offer) => toOfferView(offer, tenant.organizationId));

            return {
                id: row.id,
                orderId: row.orderId,
                status: row.status,
                source: row.source,
                route: row.route,
                tripType: row.tripType,
                loadType: row.loadType,
                category: row.category,
                description: row.description,
                weight: Number(row.weight),
                weightUnit: row.weightUnit,
                packing: row.packing,
                isHazardous: row.isHazardous ?? false,
                hazchemCode: row.hazchemCode,
                isRefrigerated: row.isRefrigerated ?? false,
                temperature: toNumber(row.temperature),
                temperatureInstructions: row.temperatureInstructions,
                loadingAddress: row.loadingAddress,
                offloadingAddress: row.offloadingAddress,
                distance: row.distance,
                deliveries: row.deliveries,
                expectedTrucks: row.expectedTrucks,
                expectedLoadingDate: row.expectedLoadingDate,
                expectedOffloadingDate: row.expectedOffloadingDate,
                actualLoadingDate: row.actualLoadingDate,
                actualOffloadingDate: row.actualOffloadingDate,
                arrivalAtLoading: row.arrivalAtLoading,
                arrivalAtOffloading: row.arrivalAtOffloading,
                arrivalAtBorder: row.arrivalAtBorder,
                departureFromBorder: row.departureFromBorder,
                counterparty: carrier
                    ? { id: row.shipperId, name: row.shipperName }
                    : { id: row.carrierId, name: row.carrierName },
                money: toMoneyDetail(
                    carrier
                        ? {
                            moneySubtotal: row.carrierSubtotal,
                            moneyVAT: row.carrierVAT,
                            moneyTotal: row.carrierTotal,
                            moneyCurrency: row.carrierCurrency,
                            isMine,
                        }
                        : {
                            moneySubtotal: row.shipperSubtotal,
                            moneyVAT: row.shipperVAT,
                            moneyTotal: row.shipperTotal,
                            moneyCurrency: row.shipperCurrency,
                            isMine,
                        },
                ),
                // Who is driving, and in what, is the trip's own business:
                // the client that filed it and the carrier running it, and
                // nobody who merely bid on it
                dispatch: isMine && hasRig(row.status)
                    ? {
                        driverName: row.driverName,
                        driverPhoneNumber: row.driverPhoneNumber,
                        // The client is told who is driving, not their
                        // document number — that is the carrier's own record
                        driverPassport: carrier ? row.driverPassport : null,
                        truckPlate: row.truckPlate,
                        trailerPlate: row.trailerPlate,
                        linkPlate: row.linkPlate,
                        truckAge: row.truckAge,
                    }
                    : null,
                podStatus: row.podStatus,
                version: row.version,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                offers,
                requests,
                documents,
                linkedLoadId,
                permissions: {
                    isMine,
                    canCancel: !carrier && (row.status === "prospect" || row.status === "booked"),
                    canDispatch: carrier && isMine && row.status === "booked",
                    canQuote: carrier
                        && row.status === "prospect"
                        && requests.some((request) => request.status === "requested" || request.status === "quoted")
                        && !offers.some((offer) => offer.status === "pending"),
                    canTransition: carrier && isMine && hasRig(row.status) && !TERMINAL_STATUSES.includes(row.status),
                },
            };
        }),

    /**
     * The timeline. Metadata is never forwarded as it was stored: the offer
     * money it carries is the CARRIER's leg, so every entry is rebuilt from
     * the offers the caller may actually read — a client sees the client
     * price, a carrier sees only its own quote, and rows about another
     * carrier's offer never leave the server.
     *
     * A carrier that is not carrying the order reads its own offer rows and
     * nothing else: the trip's notes, its papers and the people who moved it
     * along belong to the carrier that won it.
     */
    history: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderHistoryEntry[]> => {
            const tenant = scopeOf(ctx.tenant);
            const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);
            const reader = sideScope(tenant, row);
            const isMine = ownsOrder(row, tenant);

            const [entries, offerRows] = await Promise.all([
                ctx.db
                    .select({
                        id: orderHistory.id,
                        kind: orderHistory.kind,
                        fromStatus: orderHistory.fromStatus,
                        toStatus: orderHistory.toStatus,
                        metadata: orderHistory.metadata,
                        createdAt: orderHistory.createdAt,
                        actorName: user.name,
                    })
                    .from(orderHistory)
                    .leftJoin(user, eq(user.id, orderHistory.actorUserId))
                    .where(and(
                        eq(orderHistory.orderId, row.id),
                        inArray(orderHistory.kind, [...PORTAL_HISTORY_KINDS]),
                    ))
                    .orderBy(desc(orderHistory.createdAt))
                    .limit(HISTORY_LIMIT),
                ctx.db
                    .select(offerColumns(reader.orgType))
                    .from(orderOffer)
                    .where(visibleOffers(row.id, reader)),
            ]);

            const offers = new Map(offerRows.map((offer) => [
                offer.id,
                {
                    id: offer.id,
                    carrierName: offer.carrierName,
                    total: toNumber(offer.offerTotal),
                    currency: offer.currency,
                },
            ]));

            const projected: OrderHistoryEntry[] = [];

            for (const entry of entries) {
                const metadata = entry.metadata as Record<string, unknown>;
                const offerId = readOfferId(metadata);
                const offer = offerId === null ? null : offers.get(offerId) ?? null;

                // An offer row about somebody else's quote says both that
                // another carrier bid and what it did; it is dropped whole
                if (entry.kind === "offer" && offer === null) continue;

                // Everything that is not this reader's own quote is the
                // trip's history, and the trip belongs to its two parties
                if (!isMine && entry.kind !== "offer") continue;

                projected.push({
                    id: entry.id,
                    kind: entry.kind,
                    fromStatus: entry.fromStatus,
                    toStatus: entry.toStatus,
                    note: typeof metadata.note === "string" ? metadata.note : null,
                    documentType: typeof metadata.type === "string"
                        ? (metadata.type as OrderDocumentType)
                        : null,
                    offer,
                    action: typeof metadata.action === "string" ? metadata.action : null,
                    actorName: entry.actorName,
                    createdAt: entry.createdAt,
                });
            }

            return projected;
        }),

    /**
     * Everything the transition UI needs, decided server-side so a dialog can
     * never offer a move the mutation would refuse: the state machine's legal
     * targets, narrowed to the ones this actor owns, with what each one
     * demands and what still blocks it.
     */
    transitionOptions: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TransitionOptions> => {
            const tenant = scopeOf(ctx.tenant);
            const loaded = await loadVisibleOrder(ctx.db, input.orderId, tenant);

            // A row the retirement script has not moved yet is still stored on
            // "to-loading", which the state machine no longer knows: read it as
            // the status that replaced it or the dialog offers nothing
            const row = { ...loaded, status: liveStatus(loaded.status) };

            const [resumeStatus, [counted]] = await Promise.all([
                row.status === "stopped" || row.status === "issue"
                    ? deriveResumeStatus(ctx.db, row.id)
                    : Promise.resolve(null),
                ctx.db
                    .select({ value: count() })
                    .from(orderOffer)
                    .where(and(eq(orderOffer.orderId, row.id), eq(orderOffer.status, "pending"))),
            ]);

            const pendingOffers = counted?.value ?? 0;
            const missing = missingForDispatch(row);
            const actor = {
                kind: "tenant" as const,
                userId: tenant.userId,
                organizationId: tenant.organizationId,
                orgType: tenant.orgType,
            };

            // A partner is never the admin the terminal reversals demand
            const machine = { status: row.status, route: row.route, role: "user" as const, resumeStatus };

            const allowed = allowedTransitions(machine)
                .filter((to) => allowedForActor(actor, row, to, {
                    // The policy only asks WHETHER a booking accepts an offer;
                    // which one is the accept mutation's business, and the
                    // blocked flag below says whether there is one at all
                    offerId: "pending",
                    resumeStatus,
                }));

            // The two moves a plan pays for: the client's booking and the
            // carrier's FIRST dispatch. A resume out of an interrupt lands on
            // "at-loading" again for a movement that was already billed, so it
            // is not on the plan's tab and must not be offered as blocked. The
            // month's usage is counted once, and only when the gated move is
            // actually on the table — every other reader of this query would
            // be paying for a number it cannot act on
            const gated = sideOf(row, tenant) !== "carrier" ? "booked"
                : row.status === "booked" ? "at-loading"
                    : null;

            const allowance = gated !== null && allowed.includes(gated)
                ? await trackingAllowance(ctx.db, tenant.organizationId)
                : null;

            // The papers of the rig STORED on the order. A booked trip
            // usually carries none — the dialog picks the rig and asks
            // kyc.rigPapers about that pick — so this only bites where ops
            // named the driver and the truck from Admin.
            const dispatch = allowed.some((to) => isDispatchMove(row.status, to))
                ? await loadDispatchReadiness(ctx.db, row)
                : null;

            // What the orderer confirmed at the loading site. The carrier
            // only reads it — a mismatch about its own truck is Appload's
            // to clear — so here it is the reason the move is refused. Only
            // the move that STARTS the load asks, the same edge the shared
            // door gates; resuming after a stop is the carrier's free move.
            const loadingCheck = row.status === "at-loading" && allowed.includes("loading")
                ? await loadLoadingCheckState(ctx.db, row.id, await openDispatchId(ctx.db, row.id))
                : null;

            const targets: TransitionOption[] = allowed.map((to) => {
                const requirements = transitionRequirements(row.status, to, { resumeStatus }) ?? [];
                const dispatching = isDispatchMove(row.status, to) ? dispatch : null;
                const checking = to === "loading" ? loadingCheck : null;
                const loadingMove = checking ? loadingMoveRequirements(checking, actor) : null;

                const blockedReason =
                    requirements.includes("offer") && pendingOffers === 0 ? "NO_OFFERS" as const
                        // Papers the stored rig lacks block the move; a rig
                        // that is not named yet does not, because the dialog
                        // is where it is picked — and that pick has its own
                        // papers block
                        : dispatching && dispatching.fields.length === 0 && dispatching.papers.length > 0
                            ? "PAPERS_MISSING" as const
                            : dispatching && dispatching.fields.length > 0 ? "INCOMPLETE_FOR_DISPATCH" as const
                                : loadingMove?.blocked ?? (
                                    to === gated && allowance !== null && !allowance.active
                                        ? "SUBSCRIPTION_REQUIRED" as const
                                        : to === gated && allowance !== null && allowance.remaining === 0
                                            ? "QUOTA_EXCEEDED" as const
                                            : null);

                // Both dispatch refusals stay openable (the bar lets them
                // through): the dispatch dialog is what fills the rig in, and
                // its papers block is where a gap is named and closed
                return {
                    to,
                    requirements,
                    blocked: blockedReason !== null,
                    blockedReason,
                    loadingCheck: checking,
                };
            });

            return {
                status: row.status,
                version: row.version,
                resumeStatus,
                targets,
                allowance,
                missingForDispatch: missing,
                pendingOffers: sideOf(row, tenant) === "shipper" ? pendingOffers : 0,
            };
        }),

    /**
     * The dispatch pack and what was confirmed at the loading site. Both
     * parties to the trip read it — the carrier is being checked, and sees
     * exactly what was checked about it — and only the shipper that ordered
     * the load may record one.
     */
    loadingCheck: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<LoadingCheckView> => {
            const tenant = scopeOf(ctx.tenant);
            const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

            // A carrier that was asked about the order, or quoted and lost,
            // is not a party to the trip: the driver's papers are not its
            // business
            if (!ownsOrder(row, tenant)) {
                return { pack: null, state: { state: "none", check: null }, checkedByName: null, photos: [], canCheck: false };
            }

            const pack = await loadDispatchPack(ctx.db, row.id);
            const state = await loadLoadingCheckState(ctx.db, row.id, pack?.id ?? null);

            // The photos OF THIS CHECK, not every loading photo on the
            // order: a re-check has its own evidence, and an upload nobody's
            // check references is not evidence of anything
            const photos = state.check && state.check.photoDocumentIds.length > 0
                ? await ctx.db
                    .select({
                        id: orderDocument.id,
                        title: orderDocument.title,
                        url: orderDocument.url,
                        mimeType: orderDocument.mimeType,
                        createdAt: orderDocument.createdAt,
                    })
                    .from(orderDocument)
                    .where(and(
                        eq(orderDocument.orderId, row.id),
                        inArray(orderDocument.id, state.check.photoDocumentIds),
                        isNull(orderDocument.deletedAt),
                    ))
                    .orderBy(orderDocument.createdAt)
                : [];

            const [checker] = state.check?.checkedBy
                ? await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, state.check.checkedBy))
                : [];

            return {
                pack,
                state,
                checkedByName: checker?.name ?? null,
                photos,
                canCheck: sideOf(row, tenant) === "shipper",
            };
        }),

    /**
     * The shipper confirming, before the load starts, that the truck and the
     * driver at the gate are the ones the pack names. A mismatch flags the
     * order; from there only Appload can let the load proceed.
     */
    recordLoadingCheck: authorizedTenantProcedure("order", ["update"])
        .input(LoadingCheckInputSchema)
        .mutation(async ({ ctx, input }) => {
            try {
                const tenant = scopeOf(ctx.tenant);
                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                assertShipperOf(row, tenant);

                const { check, order: updated } = await recordLoadingCheck(ctx.db, {
                    current: row,
                    actor: actorOf(tenant),
                    input,
                });

                return {
                    orderId: input.orderId,
                    checkId: check.id,
                    outcome: check.outcome,
                    version: updated.version,
                };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * A client files an order. Everything about the deal that is Appload's —
     * the commission, the carrier, the price — is absent by construction: the
     * payload is a strict subset, the status is always "prospect" and the
     * offer list is always empty, so `guardCreateForActor` in the shared door
     * has nothing to refuse.
     */
    create: authorizedTenantProcedure("order", ["create"])
        .input(CreateOrderBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; warning?: "DETAILS_INCOMPLETE" }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "shipper");

                const shipperName = await organizationName(ctx.db, tenant.organizationId);
                const year = currentOrderYear();

                const payload = CreateOrderSchemaServer.parse({
                    shipperId: tenant.organizationId,
                    shipperName,
                    status: "prospect",
                    offers: [],
                    loadingAddress: input.loadingAddress,
                    expectedLoadingDate: input.expectedLoadingDate,
                    offloadingAddress: input.offloadingAddress,
                    expectedOffloadingDate: input.expectedOffloadingDate,
                    distance: input.distance,
                    deliveries: input.deliveries,
                    routeType: input.routeType,
                    tripType: input.tripType,
                    category: input.category,
                    description: input.description,
                    weight: input.weight,
                    weightUnit: input.weightUnit,
                    loadType: input.loadType,
                    shipperCurrency: input.shipperCurrency,
                });

                const result = await createOrder(
                    orderContext(ctx),
                    payload,
                    { nextOrderId: portalNextOrderId(ctx.db, year) },
                );

                // Cargo particulars the shared create payload does not carry
                // yet (they live on the update schema). Written straight
                // after the row, and never fatal: the order exists either way,
                // and the client is told the details did not land rather than
                // being invited to file it a second time.
                const details = {
                    ...(input.packing !== undefined && { packing: input.packing }),
                    ...(input.expectedTrucks !== undefined && { expectedTrucks: input.expectedTrucks }),
                    ...(input.isHazardous && { isHazardous: true }),
                    ...(input.hazchemCode !== undefined && { hazchemCode: input.hazchemCode }),
                    ...(input.isRefrigerated && { isRefrigerated: true }),
                    ...(input.temperature !== undefined && { temperature: String(input.temperature) }),
                    ...(input.temperatureInstructions !== undefined && {
                        temperatureInstructions: input.temperatureInstructions,
                    }),
                    source: "client" as const,
                };

                try {
                    await ctx.db
                        .update(order)
                        .set(details)
                        .where(eq(order.id, result.order.id));
                } catch (error) {
                    console.error(`order details failed for ${result.orderId}`, error);
                    return { orderId: result.orderId, warning: "DETAILS_INCOMPLETE" };
                }

                return { orderId: result.orderId };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Sends a prospect out to connected carriers for quotes. A carrier
     * already sitting on the order is left alone; a withdrawn or declined one
     * is asked again.
     */
    sendRequests: authorizedTenantProcedure("order", ["update"])
        .input(SendRequestsBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; sent: number; skipped: number }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                assertShipperOf(row, tenant);

                if (row.status !== "prospect") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "ORDER_NOT_PROSPECT" });
                }

                await assertConnectedCarriers(ctx.db, tenant.organizationId, input.carrierOrgIds);

                const result = await writeOrderRequests(ctx.db, {
                    orderPk: row.id,
                    carrierOrgIds: input.carrierOrgIds,
                    message: input.message?.trim() || null,
                    userId: tenant.userId,
                });

                const shipperName = await organizationName(ctx.db, tenant.organizationId);

                for (const carrierOrgId of result.sent) {
                    await notify(ctx.db, {
                        organizationId: carrierOrgId,
                        kind: "order.requested",
                        email: true,
                        entityType: "order",
                        entityId: row.orderId,
                        params: { orderId: row.orderId, shipperName },
                    });
                }

                return { orderId: row.orderId, sent: result.sent.length, skipped: result.skipped.length };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Takes one carrier back off a prospect.
     *
     * A quote that carrier already made is deliberately left acceptable: the
     * client may still book the best price it was given, and withdrawing the
     * request only says it stopped waiting for an answer. Declining the quote
     * is its own action (`offers.decline`).
     */
    withdrawRequest: authorizedTenantProcedure("order", ["update"])
        .input(z.object({ orderId: z.string().nonempty(), carrierOrgId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; carrierOrgId: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                assertShipperOf(row, tenant);

                if (row.status !== "prospect") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "ORDER_NOT_PROSPECT" });
                }

                const [updated] = await ctx.db
                    .update(orderRequest)
                    .set({ status: "withdrawn", respondedAt: new Date() })
                    .where(and(
                        eq(orderRequest.orderId, row.id),
                        eq(orderRequest.carrierOrgId, input.carrierOrgId),
                        inArray(orderRequest.status, ["requested", "quoted"]),
                    ))
                    .returning({ id: orderRequest.id });

                if (!updated) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                // The carrier's own row for this order goes off with the
                // request. Best-effort, like every write on the far side of
                // an order: the next sync repairs what a failure leaves
                await withdrawApploadRequest(ctx.db, row.id, input.carrierOrgId);

                return { orderId: row.orderId, carrierOrgId: input.carrierOrgId };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The client drops the order. The shared policy allows it while the cargo
     * is still a quote or freshly booked; from loading onwards the trip is
     * Appload's to close.
     */
    cancel: authorizedTenantProcedure("order", ["cancel"])
        .input(CancelOrderBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; status: string; version: number }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                assertShipperOf(row, tenant);

                // Read before the transition settles the offers: afterwards
                // every pending row is already "lost"
                const pending = await ctx.db
                    .select({ carrierId: orderOffer.carrierId })
                    .from(orderOffer)
                    .where(and(eq(orderOffer.orderId, row.id), eq(orderOffer.status, "pending")));

                const result = await applyTransition(orderContext(ctx), {
                    orderId: row.orderId,
                    to: "cancelled",
                    note: input.note,
                    expectedVersion: input.expectedVersion,
                });

                await closeOrderRequests(ctx.db, row.id);

                const shipperName = await organizationName(ctx.db, tenant.organizationId);
                const recipients = new Set(pending.map((entry) => entry.carrierId));

                if (row.carrierId) recipients.add(row.carrierId);

                for (const carrierId of recipients) {
                    await notify(ctx.db, {
                        organizationId: carrierId,
                        kind: "order.cancelled",
                        email: true,
                        entityType: "order",
                        entityId: row.orderId,
                        params: { orderId: row.orderId, shipperName },
                    });
                }

                return {
                    orderId: result.orderId,
                    status: result.order.status,
                    version: result.order.version,
                };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The carrier drives its own trip: the forward chain at-loading … delivered,
     * plus the two interrupts and the resume the shared policy allows it.
     *
     * The booked → `at-loading` move carries the dispatch: the driver and the
     * rig are resolved against the carrier's own registry and written onto the
     * order under the optimistic lock, WHICH BUMPS THE VERSION — the transition
     * is then applied with it. Two concurrent dispatches therefore cannot both
     * win: the second finds the version moved and gets a conflict instead of
     * silently replacing the first one's driver.
     */
    transition: authorizedTenantProcedure("order", ["update"])
        .input(TransitionBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; status: string; version: number; loadingCheck?: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                if (row.carrierId !== tenant.organizationId) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
                }

                let expectedVersion = input.expectedVersion;

                // The dispatch belongs to ONE move, booked → at-loading, and
                // it is written before the transition so the gate inside the
                // shared door checks the driver it is about to commit. That
                // order also means a refused transition leaves the write
                // standing — there are no transactions here — so nothing but
                // that move may reach it: an `at-loading` from anywhere else
                // (a resume from an interrupt, an illegal jump on a trip
                // already running) never touches the rig.
                if (isDispatchMove(row.status, input.to)) {
                    if (!input.dispatch) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "DISPATCH_REQUIRED" });
                    }

                    const resolved = await resolveDispatch(ctx.db, tenant.organizationId, input.dispatch);

                    // The rig that was just picked, judged before it is
                    // written: the transition re-checks it on the stored row,
                    // but by then the driver and the plates would already be
                    // on the order — and a refused move must not leave a trip
                    // carrying a rig it never left with. The write below is
                    // the only one that can be rolled back here, by not
                    // happening, so BOTH refusals the shared door can raise
                    // are raised here first.
                    const readiness = await loadDispatchReadiness(ctx.db, {
                        ...row,
                        ...resolved,
                        // The resolved rig leaves the age alone when the
                        // truck has no year on file
                        truckAge: resolved.truckAge ?? row.truckAge,
                    });

                    if (readiness.fields.length > 0) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "INCOMPLETE_FOR_DISPATCH" });
                    }
                    if (readiness.papers.length > 0) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "PAPERS_MISSING" });
                    }

                    expectedVersion = await writeDispatch(ctx.db, row, resolved, expectedVersion);
                }

                const result = await applyTransition(orderContext(ctx), {
                    orderId: row.orderId,
                    to: input.to,
                    note: input.note,
                    expectedVersion,
                    ...(input.document && {
                        document: {
                            url: input.document.url,
                            name: input.document.title,
                            size: input.document.size,
                            mimeType: input.document.mimeType,
                        },
                    }),
                });

                // The shared door files the upload itself only when the move
                // DEMANDED it (a POD to complete, evidence to cancel) — neither
                // of which is a carrier's move. Anything else it attached is
                // filed here, so a proof of delivery lands in the documents
                // list exactly once.
                const required = transitionRequirements(row.status, input.to) ?? [];

                if (input.document && !required.includes("pod") && !required.includes("evidence")) {
                    await addOrderDocument(ctx.db, { row, tenant, document: input.document });
                }

                await notify(ctx.db, {
                    organizationId: row.shipperId,
                    kind: "order.status",
                    // The delivery is the one the client acts on
                    email: input.to === "delivered",
                    entityType: "order",
                    entityId: row.orderId,
                    params: { orderId: row.orderId, from: row.status, to: input.to },
                });

                return {
                    orderId: result.orderId,
                    status: result.order.status,
                    version: result.order.version,
                    // What the loading check said, so the activity row names
                    // who let a load start unchecked
                    ...(result.loadingCheck && { loadingCheck: result.loadingCheck }),
                };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    documents: createTRPCRouter({
        /**
         * The order's PODs, evidence and transport orders — for the two
         * parties to the trip only. A carrier that merely bid on the order
         * can read the row; the proof of what somebody else delivered is
         * not part of it.
         */
        list: tenantProcedure
            .input(z.object({ orderId: z.string().nonempty() }))
            .query(async ({ ctx, input }): Promise<OrderDocumentView[]> => {
                const tenant = scopeOf(ctx.tenant);
                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                return ownsOrder(row, tenant) ? listDocumentViews(ctx.db, row.id) : [];
            }),

        /**
         * Files an upload against the order. The carrier of the trip attaches
         * the proof of delivery and whatever else documents it; the client
         * only ever attaches evidence — the POD is the carrier's to produce.
         */
        add: authorizedTenantProcedure("document", ["upload"])
            .input(AddDocumentBaseSchema)
            .mutation(async ({ ctx, input }): Promise<OrderDocumentView> => {
                try {
                    const tenant = scopeOf(ctx.tenant);
                    const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);
                    // What may be filed follows the side of this order, not
                    // the kind of company: the client of a load it handed to
                    // Appload files what a client files
                    const side = sideOf(row, tenant);

                    if (side === "carrier" && row.carrierId !== tenant.organizationId) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
                    }
                    // The client files evidence, and the photos of its own
                    // loading check; the carrier is checked, not checking
                    if (side === "shipper" && input.type !== "evidence" && input.type !== "loading-photo") {
                        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
                    }
                    if (side === "carrier" && input.type === "loading-photo") {
                        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
                    }

                    return await addOrderDocument(ctx.db, {
                        row,
                        tenant,
                        document: {
                            type: input.type,
                            url: input.url,
                            title: input.title,
                            size: input.size,
                            mimeType: input.mimeType,
                        },
                    });
                } catch (error) {
                    throw toTRPCError(error);
                }
            }),
    }),

    offers: offersRouter,
});

// ---------------------------------------------------------------------------
// Helpers the router leans on
// ---------------------------------------------------------------------------

/** The offer id a history row is about, whichever shape it was written in. */
function readOfferId(metadata: Record<string, unknown>): string | null {
    if (typeof metadata.offerId === "string") return metadata.offerId;

    const offer = metadata.offer as { id?: unknown } | undefined;

    return offer && typeof offer.id === "string" ? offer.id : null;
}

/**
 * A carrier's own offer and own request for a page of orders. Read as two
 * flat queries rather than joined onto the list: a carrier can have quoted
 * the same order more than once over its life, and a join would multiply the
 * rows it appears in.
 */
async function loadOwnState(db: Db, orderIds: string[], tenantId: string): Promise<OwnState> {
    const [offers, requests] = await Promise.all([
        db
            .select({
                orderId: orderOffer.orderId,
                id: orderOffer.id,
                status: orderOffer.status,
                total: orderOffer.total,
                currency: orderOffer.currency,
            })
            .from(orderOffer)
            .where(and(
                inArray(orderOffer.orderId, orderIds),
                eq(orderOffer.carrierId, tenantId),
                ne(orderOffer.status, "recorded"),
            ))
            .orderBy(
                sql`case ${orderOffer.status} when 'accepted' then 0 when 'pending' then 1 else 2 end`,
                desc(orderOffer.createdAt),
            ),
        db
            .select({ orderId: orderRequest.orderId, status: orderRequest.status })
            .from(orderRequest)
            .where(and(
                inArray(orderRequest.orderId, orderIds),
                eq(orderRequest.carrierOrgId, tenantId),
            )),
    ]);

    const offerByOrder: OwnState["offers"] = new Map();

    // The live one wins, then the newest — the ordering above put it first
    for (const offer of offers) {
        if (offerByOrder.has(offer.orderId)) continue;

        offerByOrder.set(offer.orderId, {
            id: offer.id,
            status: offer.status,
            total: Number(offer.total),
            currency: offer.currency,
        });
    }

    return {
        offers: offerByOrder,
        requests: new Map(requests.map((request) => [request.orderId, request.status])),
    };
}

/**
 * The rig the dispatch picked, as the order stores it: the driver's own
 * details and the plates behind the vehicle ids.
 */
type ResolvedDispatch = {
    driverId: string;
    driverName: string;
    driverPhoneNumber: string | null;
    driverPassport: string | null;
    truckPlate: string;
    /** Undefined for a truck registered without a year: the column is left alone */
    truckAge: (typeof TRUCK_AGE)[number] | undefined;
    trailerPlate: string | null;
    linkPlate: string | null;
};

/**
 * Turns the ids the dialog picked into the rows behind them, each one checked
 * against the carrier's own registry.
 *
 * Separate from the write because the papers of that rig are judged BEFORE
 * anything is stored: a dispatch the gate would refuse must not leave the
 * driver and the plates on the order, and there are no transactions here to
 * take them back.
 */
async function resolveDispatch(
    db: Db,
    tenantId: string,
    dispatch: { driverId: string; truckId: string; trailerId?: string; linkId?: string },
): Promise<ResolvedDispatch> {
    const [driverRow] = await db
        .select({
            id: driver.id,
            passport: driver.passport,
            name: user.name,
            phoneNumber: user.phoneNumber,
        })
        .from(driver)
        .innerJoin(user, eq(user.id, driver.userId))
        .where(and(eq(driver.id, dispatch.driverId), eq(driver.carrierId, tenantId)))
        .limit(1);

    if (!driverRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DRIVER_NOT_REGISTERED" });
    }

    const [truckRow] = await db
        .select({ regPlate: truck.regPlate, year: truck.year })
        .from(truck)
        .where(and(eq(truck.id, dispatch.truckId), eq(truck.carrierId, tenantId)))
        .limit(1);

    if (!truckRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TRUCK_NOT_REGISTERED" });
    }

    const trailerRow = dispatch.trailerId
        ? (await db
            .select({ regPlate: trailer.regPlate })
            .from(trailer)
            .where(and(eq(trailer.id, dispatch.trailerId), eq(trailer.carrierId, tenantId)))
            .limit(1))[0]
        : undefined;

    if (dispatch.trailerId && !trailerRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TRAILER_NOT_REGISTERED" });
    }

    const linkRow = dispatch.linkId
        ? (await db
            .select({ regPlate: link.regPlate })
            .from(link)
            .where(and(eq(link.id, dispatch.linkId), eq(link.carrierId, tenantId)))
            .limit(1))[0]
        : undefined;

    if (dispatch.linkId && !linkRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "LINK_NOT_REGISTERED" });
    }

    return {
        driverId: driverRow.id,
        driverName: driverRow.name,
        driverPhoneNumber: driverRow.phoneNumber,
        driverPassport: driverRow.passport,
        truckPlate: truckRow.regPlate,
        truckAge: truckAgeFromYear(truckRow.year),
        trailerPlate: trailerRow?.regPlate ?? null,
        linkPlate: linkRow?.regPlate ?? null,
    };
}

/**
 * Writes the resolved rig onto the order. Returns the version the transition
 * must then present — this write bumps it.
 */
async function writeDispatch(
    db: Db,
    row: Order,
    resolved: ResolvedDispatch,
    expectedVersion: number,
): Promise<number> {
    const [updated] = await db
        .update(order)
        .set({ ...resolved, version: sql`${order.version} + 1` })
        .where(and(eq(order.id, row.id), eq(order.version, expectedVersion)))
        .returning({ version: order.version });

    if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
    }

    return updated.version;
}
