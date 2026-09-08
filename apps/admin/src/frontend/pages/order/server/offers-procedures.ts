import { z } from "zod";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { orderHistory, orderOffer, order, type OrderOffer } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import type { KycStatus, OfferStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { carrierSnapshot } from "@/lib/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@/lib/orders/commission";
import { OfferDecisionSchema, OfferValuesSchemaServer } from "@/backend/schemas/offer";

import { toTRPCError } from "./procedures";

/** An offer as the pages read it: the stored row plus the carrier's live KYC state */
export type OfferRow = OrderOffer & { carrierKycStatus: KycStatus | null };

const decimal = (value: number | undefined) => (value === undefined ? null : String(value));

// The carrier's verification is the organization's business, not the
// offer's: an offer written months ago must still show whether the carrier
// is verified today, so it is joined live rather than snapshotted.
const OFFER_ROW = { offer: orderOffer, carrierKycStatus: organization.kycStatus };

const offerRows = (db: typeof Database, where: SQL) =>
    db
        .select(OFFER_ROW)
        .from(orderOffer)
        .leftJoin(organization, eq(organization.id, orderOffer.carrierId))
        .where(where);

const toOfferRow = (row: { offer: OrderOffer; carrierKycStatus: KycStatus | null }): OfferRow =>
    ({ ...row.offer, carrierKycStatus: row.carrierKycStatus });

/**
 * The accepted offer first — it is the booking — then the ones still
 * awaiting a decision, cheapest first because that is the comparison being
 * made, then everything already settled or recorded, newest first.
 */
const OFFER_ORDER = [
    sql`case ${orderOffer.status} when 'accepted' then 0 when 'pending' then 1 else 2 end`,
    sql`case when ${orderOffer.status} = 'pending' then ${orderOffer.total} end asc nulls last`,
    desc(orderOffer.createdAt),
];

/**
 * Every offer on one order, in the order the card and the picker show
 * them. Takes the order's primary key (not the human "APPL021.26" id) so
 * `order.get` can call it with the row it already loaded.
 */
export async function listOffers(db: typeof Database, orderId: string): Promise<OfferRow[]> {
    const rows = await offerRows(db, eq(orderOffer.orderId, orderId)).orderBy(...OFFER_ORDER);

    return rows.map(toOfferRow);
}

async function loadOrder(db: typeof Database, orderId: string) {
    const [row] = await db
        .select({ id: order.id, status: order.status, route: order.route })
        .from(order)
        .where(eq(order.orderId, orderId));

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/** The offer as stored, without the KYC join — the shape every mutation guards on */
async function loadOffer(db: typeof Database, offerId: string): Promise<OrderOffer> {
    const [row] = await db.select().from(orderOffer).where(eq(orderOffer.id, offerId));

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/** What every write returns: the row as it now stands, in the shape the pages read */
async function loadOfferRow(db: typeof Database, offerId: string): Promise<OfferRow> {
    const [row] = await offerRows(db, eq(orderOffer.id, offerId));

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return toOfferRow(row);
}

/**
 * Only a registered carrier may be quoted. The column has a foreign key to
 * `organization`, but nothing there says the partner is a carrier rather
 * than a shipper, so the type is checked here.
 */
async function loadCarrier(db: typeof Database, carrierId: string) {
    const [row] = await db
        .select({ id: organization.id, name: organization.name, type: organization.type })
        .from(organization)
        .where(eq(organization.id, carrierId));

    if (!row || row.type !== "carrier") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CARRIER_NOT_FOUND" });
    }

    return row;
}

/** Pending offers may still be decided, recorded ones are data Appload keeps; both may be corrected or dropped */
function assertEditable(offer: OrderOffer) {
    if (offer.status !== "pending" && offer.status !== "recorded") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_EDITABLE" });
    }
}

/** The facts every `offer` history row carries, so the timeline reads the same for all five actions */
const historyFacts = (offer: OrderOffer) => ({
    offerId: offer.id,
    carrierName: offer.carrierName,
    total: offer.total,
    currency: offer.currency,
});

export const offersRouter = createTRPCRouter({
    list: authorizedProcedure("order", ["read"])
        .input(z.object({ orderId: z.string() }))
        .query(async ({ ctx, input }): Promise<OfferRow[]> => {
            const row = await loadOrder(ctx.db, input.orderId);

            return listOffers(ctx.db, row.id);
        }),

    /**
     * The carrier's track record right now, for the offer form's preview
     * line. What an offer stores is this same pair frozen at creation.
     */
    carrierSnapshot: authorizedProcedure("order", ["read"])
        .input(z.object({ carrierId: z.string() }))
        .query(({ ctx, input }) => carrierSnapshot(ctx.db, input.carrierId)),

    /**
     * Registers a quote against an order. On a prospect it is a real
     * candidate (`pending`, acceptable through the booking transition); on
     * a booked-or-later order it is Appload's own record of what the market
     * offered (`recorded`) and can never change the order.
     */
    create: authorizedProcedure("order", ["update"])
        .input(z.object({ orderId: z.string(), values: OfferValuesSchemaServer }))
        .mutation(async ({ ctx, input }): Promise<OfferRow> => {
            try {
                const { values } = input;
                const row = await loadOrder(ctx.db, input.orderId);
                const carrier = await loadCarrier(ctx.db, values.carrierId);
                const snapshot = await carrierSnapshot(ctx.db, values.carrierId);

                const status: OfferStatus = row.status === "prospect" ? "pending" : "recorded";
                const carrierName = values.carrierName || carrier.name;
                const total = String(values.total);
                const id = crypto.randomUUID();
                // Priced as it is written: the commission Appload adds and the
                // client price that results are part of the offer, so what the
                // shipper is shown never depends on a later recomputation
                const pricing = offerPricingColumns(priceOffer({
                    carrierTotal: values.total,
                    fiscalRegime: values.fiscalRegime,
                    commissionTotal: values.commissionTotal,
                    route: row.route,
                }));

                await ctx.db.batch([
                    ctx.db.insert(orderOffer).values({
                        id,
                        orderId: row.id,
                        carrierId: values.carrierId,
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
                        status,
                        carrierSince: snapshot.since,
                        carrierTrips: snapshot.trips,
                        createdBy: ctx.session.user.id,
                    }),
                    ctx.db.insert(orderHistory).values({
                        orderId: row.id,
                        actorUserId: ctx.session.user.id,
                        kind: "offer",
                        metadata: { action: "created", offerId: id, carrierName, total, currency: values.currency },
                    }),
                ]);

                return loadOfferRow(ctx.db, id);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /** Corrects an offer that has not been decided. Accepting is a transition, never an edit. */
    update: authorizedProcedure("order", ["update"])
        .input(z.object({ offerId: z.string(), patch: OfferValuesSchemaServer.partial() }))
        .mutation(async ({ ctx, input }): Promise<OfferRow> => {
            try {
                const { patch } = input;
                const current = await loadOffer(ctx.db, input.offerId);

                assertEditable(current);

                // A different carrier is a different track record, so the
                // snapshot the offer carries has to follow it
                const carrier = patch.carrierId !== undefined && patch.carrierId !== current.carrierId
                    ? await loadCarrier(ctx.db, patch.carrierId)
                    : null;
                const snapshot = carrier ? await carrierSnapshot(ctx.db, carrier.id) : null;
                const carrierName = carrier ? patch.carrierName ?? carrier.name : patch.carrierName;

                // Any of the price's three inputs moving reprices the offer
                // against the order's route, so the client price and both VAT
                // splits stay what the typed figures say
                const repriced = patch.total !== undefined || patch.fiscalRegime !== undefined || patch.commissionTotal !== undefined
                    ? await (async () => {
                        const [parent] = await ctx.db
                            .select({ route: order.route })
                            .from(order)
                            .where(eq(order.id, current.orderId));

                        return offerPricingColumns(priceOffer({
                            carrierTotal: patch.total ?? Number(current.total),
                            fiscalRegime: patch.fiscalRegime ?? current.fiscalRegime,
                            commissionTotal: patch.commissionTotal ?? Number(current.commissionTotal ?? 0),
                            route: parent?.route ?? "national",
                        }));
                    })()
                    : null;

                const [updated] = await ctx.db
                    .update(orderOffer)
                    .set({
                        ...(patch.carrierId !== undefined && { carrierId: patch.carrierId }),
                        ...(carrierName !== undefined && { carrierName }),
                        ...(snapshot && { carrierSince: snapshot.since, carrierTrips: snapshot.trips }),
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
                    .where(eq(orderOffer.id, input.offerId))
                    .returning();

                if (!updated) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: updated.orderId,
                    actorUserId: ctx.session.user.id,
                    kind: "offer",
                    metadata: { action: "updated", ...historyFacts(updated) },
                });

                return loadOfferRow(ctx.db, updated.id);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Says no to a pending offer, or records that the carrier pulled out.
     * The row stays: a declined offer is part of how the order was priced.
     */
    decide: authorizedProcedure("order", ["update"])
        .input(OfferDecisionSchema)
        .mutation(async ({ ctx, input }): Promise<OfferRow> => {
            try {
                const current = await loadOffer(ctx.db, input.offerId);

                if (current.status !== "pending") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                }

                const [updated] = await ctx.db
                    .update(orderOffer)
                    .set({
                        status: input.status,
                        decidedAt: new Date(),
                        decidedBy: ctx.session.user.id,
                        decisionNote: input.note || null,
                    })
                    .where(eq(orderOffer.id, input.offerId))
                    .returning();

                if (!updated) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: updated.orderId,
                    actorUserId: ctx.session.user.id,
                    kind: "offer",
                    metadata: {
                        action: input.status,
                        ...historyFacts(updated),
                        ...(input.note && { note: input.note }),
                    },
                });

                return loadOfferRow(ctx.db, updated.id);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Hard delete, for an offer typed by mistake. Decided offers are never
     * removed — they are the record of the decision — so only pending and
     * recorded rows come through here, and the history row outlives the row.
     */
    remove: authorizedProcedure("order", ["update"])
        .input(z.object({ offerId: z.string() }))
        .mutation(async ({ ctx, input }): Promise<{ offerId: string }> => {
            try {
                const current = await loadOffer(ctx.db, input.offerId);

                assertEditable(current);

                await ctx.db.batch([
                    ctx.db.delete(orderOffer).where(eq(orderOffer.id, input.offerId)),
                    ctx.db.insert(orderHistory).values({
                        orderId: current.orderId,
                        actorUserId: ctx.session.user.id,
                        kind: "offer",
                        metadata: { action: "removed", ...historyFacts(current) },
                    }),
                ]);

                return { offerId: input.offerId };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),
});
