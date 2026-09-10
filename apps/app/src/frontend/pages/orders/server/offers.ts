import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";

import { order, orderHistory, orderOffer } from "@workspace/db/orders";
import { orderRequest } from "@workspace/db/quotes";

import { notify } from "@workspace/domain/notifications";
import { carrierSnapshot } from "@workspace/domain/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@workspace/domain/orders/commission";
import { applyTransition } from "@workspace/domain/orders/transition";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import {
    AcceptOfferBaseSchema,
    DeclineOfferBaseSchema,
    OfferPatchBaseSchema,
    OfferValuesBaseSchema,
} from "@/backend/schemas/offer";
import type { OrderOfferView } from "@/frontend/pages/orders/types";
import {
    assertOrgType,
    loadVisibleOrder,
    offerColumns,
    orderContext,
    organizationName,
    scopeOf,
    toOfferView,
    visibleOffers,
    toTRPCError,
    type Db,
    type TenantScope,
} from "@/frontend/pages/orders/server/projection";

const decimal = (value: number | undefined) => (value === undefined ? null : String(value));

/**
 * The accepted offer first — it is the booking — then the ones still awaiting
 * a decision, cheapest first because that is the comparison being made, then
 * everything settled, newest first. Same ordering Admin's offer card uses.
 */
const OFFER_ORDER = [
    sql`case ${orderOffer.status} when 'accepted' then 0 when 'pending' then 1 else 2 end`,
    sql`case when ${orderOffer.status} = 'pending' then ${orderOffer.total} end asc nulls last`,
    desc(orderOffer.createdAt),
];

/** One offer in the caller's own money, or NOT_FOUND when it is not theirs to read. */
async function loadOfferView(db: Db, offerId: string, tenant: TenantScope): Promise<OrderOfferView> {
    const [row] = await db
        .select(offerColumns(tenant.orgType))
        .from(orderOffer)
        .innerJoin(order, eq(order.id, orderOffer.orderId))
        .where(and(
            eq(orderOffer.id, offerId),
            // Recorded rows are Appload's own record of a deal done outside
            // the portal, never a partner's quote — on either side
            ne(orderOffer.status, "recorded"),
            tenant.orgType === "shipper"
                ? eq(order.shipperId, tenant.organizationId)
                : eq(orderOffer.carrierId, tenant.organizationId),
        ))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return toOfferView(row, tenant.organizationId);
}

/**
 * The carrier's own offer on an order, with what the mutation needs to guard
 * on: the order it hangs off, its status and its route (which prices it).
 */
async function loadOwnOffer(db: Db, offerId: string, tenantId: string) {
    const [row] = await db
        .select({
            id: orderOffer.id,
            status: orderOffer.status,
            total: orderOffer.total,
            fiscalRegime: orderOffer.fiscalRegime,
            commissionTotal: orderOffer.commissionTotal,
            carrierName: orderOffer.carrierName,
            currency: orderOffer.currency,
            orderPk: order.id,
            orderId: order.orderId,
            orderStatus: order.status,
            route: order.route,
            shipperId: order.shipperId,
        })
        .from(orderOffer)
        .innerJoin(order, eq(order.id, orderOffer.orderId))
        .where(and(eq(orderOffer.id, offerId), eq(orderOffer.carrierId, tenantId)))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

export const offersRouter = createTRPCRouter({
    /**
     * The offers on one order, projected per side: the client sees every real
     * candidate at the price IT would pay, the carrier sees only its own quote.
     */
    listForOrder: tenantProcedure
        .input(z.object({ orderId: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderOfferView[]> => {
            const tenant = scopeOf(ctx.tenant);
            const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

            const rows = await ctx.db
                .select(offerColumns(tenant.orgType))
                .from(orderOffer)
                .where(visibleOffers(row.id, tenant))
                .orderBy(...OFFER_ORDER);

            return rows.map((offer) => toOfferView(offer, tenant.organizationId));
        }),

    /**
     * A carrier answering a request. Appload's commission is not the carrier's
     * to set, so the offer is priced with a zero commission: the client price
     * equals the quote until staff price the deal in Admin.
     */
    create: authorizedTenantProcedure("offer", ["create"])
        .input(z.object({ orderId: z.string().nonempty(), values: OfferValuesBaseSchema }))
        .mutation(async ({ ctx, input }): Promise<OrderOfferView> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                if (row.status !== "prospect") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "ORDER_NOT_PROSPECT" });
                }

                // Only a carrier that was actually asked may quote: the
                // visibility predicate lets a past bidder see the order, it
                // does not let it bid again on a request that is closed
                const [request] = await ctx.db
                    .select({ id: orderRequest.id, status: orderRequest.status })
                    .from(orderRequest)
                    .where(and(
                        eq(orderRequest.orderId, row.id),
                        eq(orderRequest.carrierOrgId, tenant.organizationId),
                        inArray(orderRequest.status, ["requested", "quoted"]),
                    ))
                    .limit(1);

                if (!request) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_REQUESTED" });
                }

                const [existing] = await ctx.db
                    .select({ id: orderOffer.id })
                    .from(orderOffer)
                    .where(and(
                        eq(orderOffer.orderId, row.id),
                        eq(orderOffer.carrierId, tenant.organizationId),
                        eq(orderOffer.status, "pending"),
                    ))
                    .limit(1);

                if (existing) {
                    throw new TRPCError({ code: "CONFLICT", message: "OFFER_EXISTS" });
                }

                const { values } = input;
                const carrierName = await organizationName(ctx.db, tenant.organizationId);
                const snapshot = await carrierSnapshot(ctx.db, tenant.organizationId);
                const id = crypto.randomUUID();
                const total = String(values.total);

                const pricing = offerPricingColumns(priceOffer({
                    carrierTotal: values.total,
                    fiscalRegime: values.fiscalRegime,
                    commissionTotal: 0,
                    route: row.route,
                }));

                await ctx.db.batch([
                    ctx.db.insert(orderOffer).values({
                        id,
                        orderId: row.id,
                        carrierId: tenant.organizationId,
                        carrierName,
                        fiscalRegime: values.fiscalRegime,
                        subtotal: decimal(values.subtotal),
                        vat: decimal(values.vat),
                        total,
                        currency: values.currency,
                        ...pricing,
                        includesGit: values.includesGit,
                        includesGps: values.includesGps,
                        notes: values.notes || null,
                        status: "pending",
                        carrierSince: snapshot.since,
                        carrierTrips: snapshot.trips,
                        createdBy: tenant.userId,
                    }),
                    ctx.db.insert(orderHistory).values({
                        orderId: row.id,
                        actorUserId: tenant.userId,
                        kind: "offer",
                        metadata: { action: "created", offerId: id, carrierName, total, currency: values.currency },
                    }),
                ]);

                // The request has been answered. Written after the offer so a
                // failure here leaves a quoted order still marked "requested",
                // never a request marked answered with nothing to show
                await ctx.db
                    .update(orderRequest)
                    .set({ status: "quoted", respondedAt: new Date() })
                    .where(eq(orderRequest.id, request.id));

                await notify(ctx.db, {
                    organizationId: row.shipperId,
                    kind: "order.quoted",
                    email: true,
                    entityType: "order",
                    entityId: row.orderId,
                    params: { orderId: row.orderId, carrierName },
                });

                return await loadOfferView(ctx.db, id, tenant);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Corrects a quote nobody has decided yet. Appload's cut rides along
     * untouched: repricing with a zero commission would silently wipe a
     * commission staff had set on the row.
     */
    update: authorizedTenantProcedure("offer", ["update"])
        .input(z.object({ offerId: z.string().nonempty(), patch: OfferPatchBaseSchema }))
        .mutation(async ({ ctx, input }): Promise<OrderOfferView> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                const current = await loadOwnOffer(ctx.db, input.offerId, tenant.organizationId);

                if (current.status !== "pending") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                }
                if (current.orderStatus !== "prospect") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "ORDER_NOT_PROSPECT" });
                }

                const { patch } = input;

                const repriced = patch.total !== undefined || patch.fiscalRegime !== undefined
                    ? offerPricingColumns(priceOffer({
                        carrierTotal: patch.total ?? Number(current.total),
                        fiscalRegime: patch.fiscalRegime ?? current.fiscalRegime,
                        commissionTotal: Number(current.commissionTotal ?? 0),
                        route: current.route,
                    }))
                    : null;

                const [updated] = await ctx.db
                    .update(orderOffer)
                    .set({
                        ...(patch.fiscalRegime !== undefined && { fiscalRegime: patch.fiscalRegime }),
                        ...(patch.subtotal !== undefined && { subtotal: decimal(patch.subtotal) }),
                        ...(patch.vat !== undefined && { vat: decimal(patch.vat) }),
                        ...(patch.total !== undefined && { total: String(patch.total) }),
                        ...(patch.currency !== undefined && { currency: patch.currency }),
                        ...repriced,
                        ...(patch.includesGit !== undefined && { includesGit: patch.includesGit }),
                        ...(patch.includesGps !== undefined && { includesGps: patch.includesGps }),
                        ...(patch.notes !== undefined && { notes: patch.notes || null }),
                    })
                    .where(and(
                        eq(orderOffer.id, current.id),
                        eq(orderOffer.carrierId, tenant.organizationId),
                        eq(orderOffer.status, "pending"),
                    ))
                    .returning({ id: orderOffer.id, total: orderOffer.total, currency: orderOffer.currency });

                if (!updated) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: current.orderPk,
                    actorUserId: tenant.userId,
                    kind: "offer",
                    metadata: {
                        action: "updated",
                        offerId: updated.id,
                        carrierName: current.carrierName,
                        total: updated.total,
                        currency: updated.currency,
                    },
                });

                return await loadOfferView(ctx.db, updated.id, tenant);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The carrier pulls its quote. The row stays as the record of what was
     * offered, and the request goes back to "requested" — the client is
     * waiting on this carrier again.
     */
    withdraw: authorizedTenantProcedure("offer", ["update"])
        .input(z.object({ offerId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ offerId: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                const current = await loadOwnOffer(ctx.db, input.offerId, tenant.organizationId);

                if (current.status !== "pending") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                }

                const [updated] = await ctx.db
                    .update(orderOffer)
                    .set({
                        status: "withdrawn",
                        decidedAt: new Date(),
                        decidedBy: tenant.userId,
                    })
                    .where(and(
                        eq(orderOffer.id, current.id),
                        eq(orderOffer.carrierId, tenant.organizationId),
                        eq(orderOffer.status, "pending"),
                    ))
                    .returning({ id: orderOffer.id });

                if (!updated) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                await ctx.db.batch([
                    ctx.db
                        .update(orderRequest)
                        .set({ status: "requested", respondedAt: null })
                        .where(and(
                            eq(orderRequest.orderId, current.orderPk),
                            eq(orderRequest.carrierOrgId, tenant.organizationId),
                            eq(orderRequest.status, "quoted"),
                        )),
                    ctx.db.insert(orderHistory).values({
                        orderId: current.orderPk,
                        actorUserId: tenant.userId,
                        kind: "offer",
                        metadata: {
                            action: "withdrawn",
                            offerId: current.id,
                            carrierName: current.carrierName,
                            total: current.total,
                            currency: current.currency,
                        },
                    }),
                ]);

                return { offerId: current.id };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The booking door. Everything a booking implies — the carrier and its
     * price copied onto the order, the losers settled, the KYC gate, the
     * currency lock, the history row, the logbook outbox — belongs to the
     * shared transition; this procedure adds only what is portal business:
     * closing the request round and telling the carriers.
     *
     * Gated on `order:create`, not on `offer:update`: accepting is filing the
     * order, and the other way in — `quotes.accept` — says the same thing.
     * Answering an offer and committing the company to one are two different
     * decisions and must not share a statement.
     */
    accept: authorizedTenantProcedure("order", ["create"])
        .input(AcceptOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string; status: string; version: number }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "shipper");

                const row = await loadVisibleOrder(ctx.db, input.orderId, tenant);

                // The winner and the losers are read before the transition
                // settles them: afterwards every pending row is already "lost"
                const [offer] = await ctx.db
                    .select({ id: orderOffer.id, carrierId: orderOffer.carrierId })
                    .from(orderOffer)
                    .where(and(eq(orderOffer.id, input.offerId), eq(orderOffer.orderId, row.id)))
                    .limit(1);

                if (!offer) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                const pending = await ctx.db
                    .select({ carrierId: orderOffer.carrierId })
                    .from(orderOffer)
                    .where(and(eq(orderOffer.orderId, row.id), eq(orderOffer.status, "pending")));

                const result = await applyTransition(orderContext(ctx), {
                    orderId: row.orderId,
                    to: "booked",
                    offerId: offer.id,
                    expectedVersion: input.expectedVersion,
                });

                // The round is over for everyone who was asked
                await ctx.db
                    .update(orderRequest)
                    .set({ status: "closed" })
                    .where(and(
                        eq(orderRequest.orderId, row.id),
                        notInArray(orderRequest.status, ["closed"]),
                    ));

                const shipperName = await organizationName(ctx.db, tenant.organizationId);

                await notify(ctx.db, {
                    organizationId: offer.carrierId,
                    kind: "order.booked",
                    email: true,
                    entityType: "order",
                    entityId: row.orderId,
                    params: { orderId: row.orderId, shipperName },
                });

                const losers = [...new Set(pending.map((entry) => entry.carrierId))]
                    .filter((carrierId) => carrierId !== offer.carrierId);

                for (const carrierId of losers) {
                    await notify(ctx.db, {
                        organizationId: carrierId,
                        kind: "quote.declined",
                        email: false,
                        entityType: "order",
                        entityId: row.orderId,
                        params: { orderId: row.orderId },
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
     * Says no to one quote without touching the order: the client may still
     * be waiting on the others, and the row is part of how the order was
     * priced.
     */
    decline: authorizedTenantProcedure("offer", ["update"])
        .input(DeclineOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ offerId: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "shipper");

                // The offer is reached through the order the tenant owns; an
                // id on its own never selects a row
                const [current] = await ctx.db
                    .select({
                        id: orderOffer.id,
                        status: orderOffer.status,
                        carrierId: orderOffer.carrierId,
                        carrierName: orderOffer.carrierName,
                        total: orderOffer.total,
                        currency: orderOffer.currency,
                        orderPk: order.id,
                        orderId: order.orderId,
                    })
                    .from(orderOffer)
                    .innerJoin(order, eq(order.id, orderOffer.orderId))
                    .where(and(
                        eq(orderOffer.id, input.offerId),
                        eq(order.shipperId, tenant.organizationId),
                    ))
                    .limit(1);

                if (!current) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }
                if (current.status !== "pending") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                }

                const [updated] = await ctx.db
                    .update(orderOffer)
                    .set({
                        status: "declined",
                        decidedAt: new Date(),
                        decidedBy: tenant.userId,
                        decisionNote: input.note || null,
                    })
                    .where(and(eq(orderOffer.id, current.id), eq(orderOffer.status, "pending")))
                    .returning({ id: orderOffer.id });

                if (!updated) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: current.orderPk,
                    actorUserId: tenant.userId,
                    kind: "offer",
                    metadata: {
                        action: "declined",
                        offerId: current.id,
                        carrierName: current.carrierName,
                        total: current.total,
                        currency: current.currency,
                        ...(input.note && { note: input.note }),
                    },
                });

                await notify(ctx.db, {
                    organizationId: current.carrierId,
                    kind: "quote.declined",
                    email: false,
                    entityType: "order",
                    entityId: current.orderId,
                    params: { orderId: current.orderId },
                });

                return { offerId: current.id };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),
});
