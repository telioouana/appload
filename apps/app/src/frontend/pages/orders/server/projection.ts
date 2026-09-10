import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";

import { order, orderOffer, type Order, type OrderOffer } from "@workspace/db/orders";
import { orderRequest, type OrderRequestStatus } from "@workspace/db/quotes";
import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";
import type { OfferStatus, OrderStatus } from "@workspace/db/types";

import type { Actor } from "@workspace/domain/orders/actor";
import type { OrderContext } from "@workspace/domain/orders/transition";
import { pendingOfferCount } from "@workspace/domain/orders/transition";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";
import { OrderError } from "@workspace/domain/orders/errors";

import { foreignKeyViolationConstraint } from "@/lib/db-errors";
import type {
    Currency,
    OrderMoney,
    OrderMoneyDetail,
    OrderOfferView,
    OrderSection,
    OrgType,
} from "@/frontend/pages/orders/types";

export type Db = typeof Database;

/**
 * The tenant, as every read and write in this feature scopes on it. Taken
 * from the gate (`ctx.tenant`), never from the session's active organization.
 */
export type TenantScope = {
    userId: string;
    organizationId: string;
    orgType: OrgType;
};

/** The gate's result narrowed to what this feature scopes on. */
export const scopeOf = (tenant: TenantScope): TenantScope => ({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    orgType: tenant.orgType,
});

/**
 * A procedure whose whole meaning belongs to one side of the deal (only a
 * client files an order, only a carrier drives one) refuses the other side
 * outright, on top of the role statement its gate already checked.
 */
export function assertOrgType(tenant: TenantScope, orgType: OrgType) {
    if (tenant.orgType !== orgType) {
        throw new TRPCError({ code: "FORBIDDEN", message: "WRONG_ORGANIZATION_TYPE" });
    }
}

export const actorOf = (tenant: TenantScope): Actor => ({
    kind: "tenant",
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    orgType: tenant.orgType,
});

/**
 * What the shared order door needs from a portal request. `sheets: "defer"`
 * is the portal's whole Sheets story: nothing is pushed here, the outbox row
 * is left pending and Admin's existing sync cron heals the logbook.
 */
export const orderContext = (
    ctx: { db: Db; tenant: TenantScope; waitUntil?: (promise: Promise<unknown>) => void },
): OrderContext => ({
    db: ctx.db,
    actor: actorOf(ctx.tenant),
    waitUntil: ctx.waitUntil,
    sheets: "defer",
});

// ---------------------------------------------------------------------------
// Visibility. One predicate, composed into every read: the shipper sees the
// orders it filed; the carrier sees the orders it is carrying, was asked
// about, or quoted for. Nothing else on the shared `order` table exists as
// far as the portal is concerned.
// ---------------------------------------------------------------------------

/**
 * Correlated EXISTS over the order's requests. The conditions go in as
 * drizzle expressions rather than bare columns: a `PgColumn` interpolated
 * straight into a template loses its table prefix when the outer query has
 * no joins, which would bind `order_id` to the wrong table (the same reason
 * `pendingOfferCount` is written this way).
 */
const requestExists = (where: SQL | undefined) => sql`exists (
    select 1 from ${orderRequest} where ${where}
)`;

/** Correlated EXISTS over the order's offers. */
const offerExists = (where: SQL | undefined) => sql`exists (
    select 1 from ${orderOffer} where ${where}
)`;

/** A request addressed to this carrier, optionally narrowed to some statuses. */
export const myRequest = (tenantId: string, statuses?: readonly OrderRequestStatus[]) =>
    requestExists(and(
        eq(orderRequest.orderId, order.id),
        eq(orderRequest.carrierOrgId, tenantId),
        statuses ? inArray(orderRequest.status, [...statuses]) : undefined,
    ));

/** An offer by this carrier. Recorded rows are Appload's data and never count. */
export const myOffer = (tenantId: string, statuses?: readonly OfferStatus[]) =>
    offerExists(and(
        eq(orderOffer.orderId, order.id),
        eq(orderOffer.carrierId, tenantId),
        statuses ? inArray(orderOffer.status, [...statuses]) : ne(orderOffer.status, "recorded"),
    ));

/** Any request on the order, whoever it went to — the shipper's own side. */
const anyRequest = (statuses: readonly OrderRequestStatus[]) =>
    requestExists(and(
        eq(orderRequest.orderId, order.id),
        inArray(orderRequest.status, [...statuses]),
    ));

/**
 * THE tenant predicate. Every query in this feature composes it, and ids
 * taken from input are only ever combined with it — never used alone.
 */
export function visibleOrders(tenantId: string, orgType: OrgType): SQL {
    if (orgType === "shipper") {
        return eq(order.shipperId, tenantId);
    }

    return or(
        eq(order.carrierId, tenantId),
        myRequest(tenantId),
        myOffer(tenantId),
    ) as SQL;
}

/**
 * Whether the order is the reader's OWN deal: the shipper that filed it, or
 * the carrier actually carrying it. Seeing an order and being a party to it
 * are two different things — a carrier that was asked about an order, or
 * quoted for one and lost, still reads the row — and everything the two
 * sides stored on it (the price, the driver, the rig, the trip's papers)
 * belongs to whoever won it.
 */
export const ownsOrder = (row: Pick<Order, "shipperId" | "carrierId">, tenant: TenantScope): boolean =>
    tenant.orgType === "shipper"
        ? row.shipperId === tenant.organizationId
        : row.carrierId === tenant.organizationId;

/** The same question as a selected column, for the list. */
export const isMineColumn = (tenant: TenantScope): SQL<boolean> =>
    tenant.orgType === "shipper"
        ? sql<boolean>`true`
        : sql<boolean>`coalesce(${eq(order.carrierId, tenant.organizationId)}, false)`;

const CLOSED_STATUSES: OrderStatus[] = ["completed", "cancelled", "underbid"];

/** Offer statuses a carrier lost the order with — its own history. */
const LOST_OFFER_STATUSES = ["lost", "declined", "withdrawn"] as const;

/** The extra condition a section adds on top of the visibility predicate. */
export function sectionPredicate(
    section: OrderSection,
    tenantId: string,
    orgType: OrgType,
): SQL | undefined {
    if (orgType === "shipper") {
        switch (section) {
            case "all": return undefined;
            case "requests":
                return and(eq(order.status, "prospect"), anyRequest(["requested", "quoted"]));
            case "quoted":
                return and(eq(order.status, "prospect"), sql`${pendingOfferCount} > 0`);
            case "booked": return eq(order.status, "booked");
            case "on-going": return inArray(order.status, TRACKED_STATUSES);
            case "delivered": return eq(order.status, "delivered");
            case "history": return inArray(order.status, CLOSED_STATUSES);
        }
    }

    switch (section) {
        // A carrier has no "all" page; an unknown segment falls back to
        // everything it may see rather than to another tenant's rows
        case "all": return undefined;
        case "requests": return myRequest(tenantId, ["requested"]);
        case "quoted": return myOffer(tenantId, ["pending"]);
        case "booked": return and(eq(order.carrierId, tenantId), eq(order.status, "booked"));
        case "on-going": return and(eq(order.carrierId, tenantId), inArray(order.status, TRACKED_STATUSES));
        case "delivered": return and(eq(order.carrierId, tenantId), eq(order.status, "delivered"));
        case "history":
            return or(
                and(eq(order.carrierId, tenantId), inArray(order.status, ["completed", "cancelled"])),
                myOffer(tenantId, LOST_OFFER_STATUSES),
            );
    }
}

/** The whole scope of one list read: what the tenant may see, narrowed to a section. */
export const orderScope = (section: OrderSection, tenantId: string, orgType: OrgType) =>
    and(visibleOrders(tenantId, orgType), sectionPredicate(section, tenantId, orgType));

// ---------------------------------------------------------------------------
// Money projection. A leg belongs to the party that pays or gets paid it, and
// Appload's commission belongs to neither. These builders are the only place
// a money column enters a portal response, so the rule cannot be forgotten in
// one query out of eight.
// ---------------------------------------------------------------------------

export const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * The tenant's own leg, as selected columns (both branches share key names).
 * Selecting them is not the same as showing them: `toMoney` still asks
 * whether the row is the reader's own deal.
 */
export const moneyColumns = (orgType: OrgType) =>
    orgType === "shipper"
        ? {
            moneySubtotal: order.shipperSubtotal,
            moneyVAT: order.shipperVAT,
            moneyTotal: order.shipperTotal,
            moneyCurrency: order.shipperCurrency,
        }
        : {
            moneySubtotal: order.carrierSubtotal,
            moneyVAT: order.carrierVAT,
            moneyTotal: order.carrierTotal,
            moneyCurrency: order.carrierCurrency,
        };

type MoneyRow = {
    moneySubtotal: string | null;
    moneyVAT: string | null;
    moneyTotal: string | null;
    moneyCurrency: Currency | null;
    /** Whether the leg is the reader's own — see `ownsOrder` */
    isMine: boolean;
};

/**
 * The carrier columns hold the price of the carrier that WON the order, so a
 * reader who is not a party to it gets no figure at all. These two mappers
 * are the only place money enters a portal response, which is why the check
 * lives here rather than in each caller.
 */
const NO_MONEY = { total: null, currency: "MZN" } as const;

export const toMoney = (row: MoneyRow): OrderMoney =>
    row.isMine
        ? { total: toNumber(row.moneyTotal), currency: row.moneyCurrency ?? "MZN" }
        : { ...NO_MONEY };

export const toMoneyDetail = (row: MoneyRow): OrderMoneyDetail =>
    row.isMine
        ? {
            subtotal: toNumber(row.moneySubtotal),
            vat: toNumber(row.moneyVAT),
            total: toNumber(row.moneyTotal),
            currency: row.moneyCurrency ?? "MZN",
        }
        : { ...NO_MONEY, subtotal: null, vat: null };

/**
 * The offer columns a portal response may carry. A shipper is shown the
 * CLIENT price (what the offer would cost it); a carrier is shown its own
 * quote. `commission*` is in neither list, and no caller selects the whole
 * row.
 */
export const offerColumns = (orgType: OrgType) => ({
    id: orderOffer.id,
    orderId: orderOffer.orderId,
    carrierId: orderOffer.carrierId,
    carrierName: orderOffer.carrierName,
    status: orderOffer.status,
    fiscalRegime: orderOffer.fiscalRegime,
    currency: orderOffer.currency,
    includesGit: orderOffer.includesGit,
    includesGps: orderOffer.includesGps,
    notes: orderOffer.notes,
    carrierSince: orderOffer.carrierSince,
    carrierTrips: orderOffer.carrierTrips,
    decisionNote: orderOffer.decisionNote,
    decidedAt: orderOffer.decidedAt,
    createdAt: orderOffer.createdAt,
    offerSubtotal: orgType === "shipper" ? orderOffer.clientSubtotal : orderOffer.subtotal,
    offerVAT: orgType === "shipper" ? orderOffer.clientVAT : orderOffer.vat,
    offerTotal: orgType === "shipper" ? orderOffer.clientTotal : orderOffer.total,
});

export type OfferProjectionRow = {
    id: string;
    carrierId: string;
    carrierName: string;
    status: OrderOffer["status"];
    fiscalRegime: OrderOffer["fiscalRegime"];
    currency: Currency;
    includesGit: boolean;
    includesGps: boolean;
    notes: string | null;
    carrierSince: Date | null;
    carrierTrips: number | null;
    decisionNote: string | null;
    decidedAt: Date | null;
    createdAt: Date;
    offerSubtotal: string | null;
    offerVAT: string | null;
    offerTotal: string | null;
};

export const toOfferView = (row: OfferProjectionRow, tenantId: string): OrderOfferView => ({
    id: row.id,
    carrierName: row.carrierName,
    status: row.status,
    subtotal: toNumber(row.offerSubtotal),
    vat: toNumber(row.offerVAT),
    total: toNumber(row.offerTotal),
    currency: row.currency,
    fiscalRegime: row.fiscalRegime,
    includesGit: row.includesGit,
    includesGps: row.includesGps,
    notes: row.notes,
    carrierSince: row.carrierSince,
    carrierTrips: row.carrierTrips,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    isMine: row.carrierId === tenantId,
});

/**
 * Which offers of an order a tenant may read: the shipper sees every real
 * candidate, a carrier sees only its own — never that someone else quoted,
 * let alone for how much. Recorded rows are excluded for BOTH: they are the
 * deals Appload registers from outside the portal, its own market data and
 * never a partner's quote.
 */
export const visibleOffers = (orderPk: string, tenant: TenantScope): SQL =>
    and(
        eq(orderOffer.orderId, orderPk),
        ne(orderOffer.status, "recorded"),
        tenant.orgType === "carrier" ? eq(orderOffer.carrierId, tenant.organizationId) : undefined,
    ) as SQL;

// ---------------------------------------------------------------------------
// Loading one order
// ---------------------------------------------------------------------------

/**
 * The stored row behind an order id, or NOT_FOUND. The full row never leaves
 * the server — the policy, the state machine and the dispatch gate all read
 * columns the tenant may not see — so callers project before returning.
 */
export async function loadVisibleOrder(
    db: Db,
    orderId: string,
    tenant: TenantScope,
): Promise<Order> {
    const [row] = await db
        .select()
        .from(order)
        .where(and(eq(order.orderId, orderId), visibleOrders(tenant.organizationId, tenant.orgType)))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/** The tenant's own company name, as the notifications and the shipper column carry it. */
export async function organizationName(db: Db, organizationId: string): Promise<string> {
    const [row] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

    return row?.name ?? "";
}

// ---------------------------------------------------------------------------
// Uploads and errors
// ---------------------------------------------------------------------------

/**
 * Documents live in EdgeStore and nowhere else: a URL pointing at another
 * host would let anything be stored as this order's proof of delivery.
 */
export function assertEdgeStoreUrl(url: string) {
    const { protocol, hostname } = new URL(url);

    if (protocol !== "https:" || !hostname.endsWith(".edgestore.dev")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

// The plate/driver columns reference the fleet registry; a violation means
// the id sent was not one of the tenant's registered vehicles
const FK_ERROR_CODES = {
    truck_plate: "TRUCK_NOT_REGISTERED",
    trailer_plate: "TRAILER_NOT_REGISTERED",
    link_plate: "LINK_NOT_REGISTERED",
    driver_id: "DRIVER_NOT_REGISTERED",
} as const;

/**
 * Domain failures travel as TRPCError with the domain code in `message`, so
 * the client maps them to translated copy (see `domainErrorCode`).
 */
export function toTRPCError(error: unknown): TRPCError {
    if (error instanceof TRPCError) {
        return error;
    }

    const fkConstraint = foreignKeyViolationConstraint(error);

    if (fkConstraint !== null) {
        for (const [column, code] of Object.entries(FK_ERROR_CODES)) {
            if (fkConstraint.includes(column)) {
                return new TRPCError({ code: "BAD_REQUEST", message: code, cause: error });
            }
        }
    }

    if (error instanceof OrderError) {
        return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.code, cause: error });
    }

    console.error("unexpected portal order failure", error);
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
}
