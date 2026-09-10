import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { orderRequest, type OrderRequestStatus } from "@workspace/db/quotes";
import { partnerConnection } from "@workspace/db/connections";
import { organization } from "@workspace/db/users";

import type { OrderRequestView } from "@/frontend/pages/orders/types";
import type { Db, TenantScope } from "@/frontend/pages/orders/server/projection";

/**
 * The RFQ side of an order: who the client asked, what came back, and when
 * the round closes. One row per (order, carrier) — asking the same carrier
 * twice reopens its row rather than stacking requests.
 */

/** Statuses a request may be reopened from: nobody is waiting on them any more. */
const REOPENABLE = ["withdrawn", "declined", "closed"] as const;

/** How many carriers on this order are in one of these states — the shipper's counters. */
export const requestCount = (statuses: readonly OrderRequestStatus[]) => sql<number>`(
    select count(*)::int from ${orderRequest}
    where ${and(
        eq(orderRequest.orderId, order.id),
        inArray(orderRequest.status, [...statuses]),
    )}
)`.mapWith(Number);

/**
 * The carriers a client may send an order to: its own accepted
 * client-carrier connections, and nothing else. Every id in the payload has
 * to resolve, so a carrier removed between opening the dialog and sending is
 * refused rather than silently dropped.
 */
export async function assertConnectedCarriers(
    db: Db,
    tenantId: string,
    carrierOrgIds: string[],
): Promise<Map<string, string>> {
    const wanted = [...new Set(carrierOrgIds)];

    const rows = await db
        .select({ id: organization.id, name: organization.name })
        .from(partnerConnection)
        .innerJoin(organization, or(
            and(eq(partnerConnection.requesterOrgId, tenantId), eq(organization.id, partnerConnection.targetOrgId)),
            and(eq(partnerConnection.targetOrgId, tenantId), eq(organization.id, partnerConnection.requesterOrgId)),
        ))
        .where(and(
            eq(partnerConnection.relation, "client-carrier"),
            eq(partnerConnection.status, "accepted"),
            eq(organization.type, "carrier"),
            inArray(organization.id, wanted),
        ));

    const found = new Map(rows.map((row) => [row.id, row.name]));

    if (found.size !== wanted.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CARRIER_NOT_CONNECTED" });
    }

    return found;
}

export type SendRequestsResult = {
    /** Carriers the order actually went out to now */
    sent: string[];
    /** Carriers that were already waiting on it */
    skipped: string[];
};

/**
 * Writes the request rows. A carrier already sitting on the order (requested
 * or quoted) is left alone — resending would reset an answer it already gave;
 * a withdrawn, declined or closed row is reopened as a fresh request.
 */
export async function writeOrderRequests(
    db: Db,
    params: { orderPk: string; carrierOrgIds: string[]; message: string | null; userId: string },
): Promise<SendRequestsResult> {
    const wanted = [...new Set(params.carrierOrgIds)];

    const existing = await db
        .select({ id: orderRequest.id, carrierOrgId: orderRequest.carrierOrgId, status: orderRequest.status })
        .from(orderRequest)
        .where(and(
            eq(orderRequest.orderId, params.orderPk),
            inArray(orderRequest.carrierOrgId, wanted),
        ));

    const byCarrier = new Map(existing.map((row) => [row.carrierOrgId, row]));

    const fresh = wanted.filter((carrierId) => !byCarrier.has(carrierId));
    const reopen = existing.filter((row) => (REOPENABLE as readonly string[]).includes(row.status));
    const skipped = existing
        .filter((row) => !(REOPENABLE as readonly string[]).includes(row.status))
        .map((row) => row.carrierOrgId);

    if (fresh.length > 0) {
        await db.insert(orderRequest).values(fresh.map((carrierOrgId) => ({
            orderId: params.orderPk,
            carrierOrgId,
            status: "requested" as const,
            message: params.message,
            createdBy: params.userId,
        })));
    }

    if (reopen.length > 0) {
        await db
            .update(orderRequest)
            .set({
                status: "requested",
                message: params.message,
                respondedAt: null,
                createdBy: params.userId,
            })
            .where(inArray(orderRequest.id, reopen.map((row) => row.id)));
    }

    return {
        sent: [...fresh, ...reopen.map((row) => row.carrierOrgId)],
        skipped,
    };
}

/** The round is over: booking or cancelling an order closes every open request. */
export async function closeOrderRequests(db: Db, orderPk: string): Promise<void> {
    await db
        .update(orderRequest)
        .set({ status: "closed" })
        .where(and(eq(orderRequest.orderId, orderPk), notInArray(orderRequest.status, ["closed"])));
}

/**
 * The request rows the caller may read: a client sees every carrier it asked,
 * a carrier sees only its own row — who else was asked is the client's
 * business.
 */
export async function listRequestViews(
    db: Db,
    orderPk: string,
    tenant: TenantScope,
): Promise<OrderRequestView[]> {
    const rows = await db
        .select({
            id: orderRequest.id,
            carrierId: orderRequest.carrierOrgId,
            carrierName: organization.name,
            status: orderRequest.status,
            message: orderRequest.message,
            respondedAt: orderRequest.respondedAt,
            createdAt: orderRequest.createdAt,
        })
        .from(orderRequest)
        .innerJoin(organization, eq(organization.id, orderRequest.carrierOrgId))
        .where(and(
            eq(orderRequest.orderId, orderPk),
            tenant.orgType === "carrier"
                ? eq(orderRequest.carrierOrgId, tenant.organizationId)
                : undefined,
        ))
        .orderBy(organization.name);

    return rows;
}
