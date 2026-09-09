import { TRPCError } from "@trpc/server";

import { order, orderHistory, orderOffer, type CreateOrder, type Order } from "@workspace/db/orders";

import { guardOrderGate } from "@workspace/domain/kyc/order-gate";
import type { Actor } from "@workspace/domain/orders/actor";
import { carrierSnapshot } from "@workspace/domain/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@workspace/domain/orders/commission";
import { derivePaymentStatus } from "@workspace/domain/orders/derive";
import { OrderError } from "@workspace/domain/orders/errors";
import { recordSheetSync } from "@workspace/domain/orders/sheet-sync";
import type { CreateOrderForm } from "@workspace/domain/orders/schemas";
import { offerMetadata, type OrderContext } from "@workspace/domain/orders/transition";

export const decimal = (value: number | undefined) => (value === undefined ? null : String(value));

/** The offer a create-shaped payload books with, or none for a prospect. */
export const acceptedOfferOf = (input: CreateOrderForm) =>
    (input.status === "booked" ? input.offers.find((offer) => offer.accepted) : undefined);

export function toInsertValues(
    input: CreateOrderForm,
    id: { orderId: string; seq: number; year: number },
    userId: string,
): CreateOrder {
    // The carrier leg is a copy of the accepted offer, never typed onto the
    // order: a prospect has none at all
    const accepted = acceptedOfferOf(input);

    return {
        orderId: id.orderId,
        seq: id.seq,
        year: id.year,

        shipperName: input.shipperName,
        shipperId: input.shipperId,

        loadingAddress: input.loadingAddress,
        expectedLoadingDate: input.expectedLoadingDate,

        offloadingAddress: input.offloadingAddress,
        expectedOffloadingDate: input.expectedOffloadingDate ?? null,

        distance: input.distance,

        category: input.category,
        description: input.description,
        weight: decimal(input.weight)!,
        weightUnit: input.weightUnit,

        status: input.status,
        // Status-driven rule: prospect → not-applicable, booked → pending
        carrierPaymentStatus: derivePaymentStatus(input.status, null) ?? null,
        shipperPaymentStatus: derivePaymentStatus(input.status, null) ?? null,
        route: input.routeType,
        tripType: input.tripType,
        loadType: input.loadType,
        deliveries: input.deliveries,

        carrierName: accepted?.carrierName ?? null,
        carrierId: accepted?.carrierId ?? null,

        driverName: input.driverName ?? null,
        driverId: input.driverId ?? null,
        driverPhoneNumber: input.driverContact ?? null,
        driverPassport: input.driverPassport ?? null,

        truckPlate: input.truckPlate,
        truckAge: input.truckAge,
        linkPlate: input.linkPlate || null,
        trailerPlate: input.trailerPlate || null,

        fiscalRegime: accepted?.fiscalRegime ?? null,
        carrierSubtotal: decimal(accepted?.subtotal),
        carrierVAT: decimal(accepted?.vat),
        carrierTotal: decimal(accepted?.total),
        // Left undefined (not null) without an offer so the column keeps its
        // "MZN" default, exactly as it did when the form typed the carrier
        carrierCurrency: accepted?.currency,

        shipperSubtotal: decimal(input.shipperSubtotal),
        shipperVAT: decimal(input.shipperVAT),
        shipperTotal: decimal(input.shipperTotal),
        shipperCurrency: input.shipperCurrency,

        insuranceSubscriber: input.insuranceSubscriber || null,
        insuranceValue: decimal(input.insuranceValue),
        insuranceCurrency: input.insuranceCurrency ?? null,
        insuranceStatus: input.insuranceStatus ?? null,

        dealDate: input.dealDate ?? null,
        apploadCommissionSubtotal: decimal(input.commissionSubtotal),
        apploadCommissionVAT: decimal(input.commissionVAT),
        apploadCommissionTotal: decimal(input.commissionTotal),

        createdBy: userId,
    };
}

/**
 * Postgres unique violation (23505) — here, the (year, seq) index
 * arbitrating two concurrent creates. Only the code matters, so the check
 * is restated rather than reaching for the app's constraint-name helper.
 */
const isUniqueViolation = (error: unknown): boolean => {
    const candidates = [error, (error as { cause?: unknown })?.cause] as Array<{ code?: string } | undefined>;

    return candidates.some((candidate) => candidate?.code === "23505");
};

export type CreateOrderOutput = {
    orderId: string;
    status: Order["status"];
    order: Order;
    warning?: "SHEET_FAILED";
};

/** The identity a create is given, exactly as `nextOrderId` mints it. */
export type OrderIdParts = { orderId: string; seq: number; year: number };

/**
 * The id is the caller's to mint: Admin continues from whichever is
 * further ahead, the database or the ORDERS sheet, and the portal has no
 * sheet to read. It is a callback rather than a value because the unique
 * (year, seq) index arbitrates concurrent creates — the retry needs a
 * freshly recomputed sequence, not the one that just lost.
 */
export type CreateOptions = { nextOrderId: (attempt: number) => Promise<OrderIdParts> };

/**
 * WHO may file this order, the create side of what `allowedForActor` decides
 * for every move. A transition reads the entitlement off the row it is about
 * to change; a create has no row yet, so it is decided on the payload: a
 * partner files an order under its own organization — the shipper its own
 * cargo, the carrier only offers of its own — and Appload's commission is
 * Appload's to set, so a tenant payload carries none.
 *
 * Staff are untouched: they create on behalf of either side, and their own
 * permission gates are checked by the router.
 */
function guardCreateForActor(actor: Actor, input: CreateOrderForm): void {
    if (actor.kind === "staff") {
        return;
    }

    const owns = actor.orgType === "shipper"
        ? input.shipperId === actor.organizationId
        : input.offers.every((offer) => offer.carrierId === actor.organizationId);

    const commission = [input.commissionSubtotal, input.commissionVAT, input.commissionTotal];

    if (!owns || commission.some((amount) => amount !== undefined && amount !== 0)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
    }
}

/**
 * Creates an order from a create-shaped payload: the KYC gate on the
 * carrier the payload books with, the row itself under the unique
 * (year, seq) index, its carrier offers (already decided when the
 * payload is booked), the birth-certificate history row, and the Sheets
 * push the context supplies. Throws domain codes as TRPCError/OrderError;
 * the callers map anything else through their own error mapper.
 */
export async function createOrder(
    ctx: OrderContext,
    input: CreateOrderForm,
    options: CreateOptions,
): Promise<CreateOrderOutput> {
    const userId = ctx.actor.userId;
    const accepted = acceptedOfferOf(input);

    guardCreateForActor(ctx.actor, input);

    // Verification only bites once a carrier is actually
    // committed: a prospect is still a quote, and quoting an
    // unverified carrier is how the backlog gets discovered.
    // The carrier is the accepted offer's; the driver and rig
    // are usually still empty here and are gated at dispatch.
    const { flagPatch } = accepted
        ? await guardOrderGate(
            ctx.db,
            {
                carrierId: accepted.carrierId,
                driverId: input.driverId,
                truckPlate: input.truckPlate,
                trailerPlate: input.trailerPlate,
                linkPlate: input.linkPlate,
            },
            ctx.actor,
        )
        : { flagPatch: null };

    // The unique (year, seq) index arbitrates concurrent creates:
    // retry once with a recomputed sequence if another create won
    let saved: Order | undefined;

    for (let attempt = 0; attempt < 2 && !saved; attempt++) {
        const id = await options.nextOrderId(attempt);

        try {
            [saved] = await ctx.db
                .insert(order)
                // The flag lands with the row it describes, so a
                // booking can never exist without the reason it
                // was questionable
                .values({ ...toInsertValues(input, id, userId), ...flagPatch })
                .returning();
        } catch (error) {
            if (!isUniqueViolation(error) || attempt === 1) {
                throw error;
            }
        }
    }

    if (!saved) {
        throw new OrderError("UNKNOWN");
    }

    // The offers the order was created with, after the row they
    // hang off. A booked payload settles them in the same
    // insert — its accepted offer booked the order, so the
    // others lost it at that same moment, all on one clock —
    // which is what acceptOffer writes when a prospect is
    // booked later.
    const decidedAt = new Date();
    const savedOffers = input.offers.length > 0
        ? await ctx.db
            .insert(orderOffer)
            .values(await Promise.all(input.offers.map(async (offer) => {
                const snapshot = await carrierSnapshot(ctx.db, offer.carrierId);

                return {
                    ...offerPricingColumns(priceOffer({
                        carrierTotal: offer.total,
                        fiscalRegime: offer.fiscalRegime,
                        commissionTotal: offer.commissionTotal,
                        route: input.routeType,
                    })),
                    orderId: saved.id,
                    carrierId: offer.carrierId,
                    carrierName: offer.carrierName,
                    fiscalRegime: offer.fiscalRegime,
                    subtotal: decimal(offer.subtotal),
                    vat: decimal(offer.vat),
                    total: String(offer.total),
                    currency: offer.currency,
                    includesGit: offer.includesGit,
                    includesGps: offer.includesGps,
                    notes: offer.notes || null,
                    status: accepted === undefined ? "pending" as const
                        : offer === accepted ? "accepted" as const
                            : "lost" as const,
                    carrierSince: snapshot.since,
                    carrierTrips: snapshot.trips,
                    ...(accepted !== undefined && { decidedAt }),
                    ...(offer === accepted && { decidedBy: userId }),
                    createdBy: userId,
                };
            })))
            .returning()
        : [];

    const acceptedOffer = savedOffers.find((offer) => offer.status === "accepted");

    // Birth certificate: fromStatus null marks creation
    await ctx.db.insert(orderHistory).values({
        orderId: saved.id,
        actorUserId: userId,
        kind: "transition",
        fromStatus: null,
        toStatus: saved.status,
        ...(acceptedOffer && { metadata: { offer: offerMetadata(acceptedOffer) } }),
    });

    // The order is stored either way; failures land in the
    // sheet_sync outbox and the retry cron heals them
    if (ctx.sheets === "defer") {
        await recordSheetSync(ctx.db, saved.id, "pending");
    } else if (!(await ctx.sheets.push(saved)).ok) {
        return { orderId: saved.orderId, status: saved.status, order: saved, warning: "SHEET_FAILED" };
    }

    return { orderId: saved.orderId, status: saved.status, order: saved };
}
