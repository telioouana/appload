import { z } from "zod";
import { and, desc, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDispute, orderDocument, orderHistory, orderOffer, sheetSync, type CreateOrder, type Order, type OrderOffer } from "@workspace/db/orders";
import { user } from "@workspace/db/users";
import { trailer, truck } from "@workspace/db/fleet";
import type { db as Database } from "@workspace/db/db";
import { ACTIVE_DISPUTE_STATUSES, isActiveDispute, ORDER_STATUS, type LoadingBay } from "@workspace/db/types";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions";
import type { Auth } from "@workspace/auth/server";
import { sendEmail } from "@workspace/auth/email";

import { CreateOrderSchemaServer, UpdateOrderSchemaServer, type CreateOrderForm } from "@/backend/schemas/order";

import { OrderError } from "@/lib/orders/errors";
import { guardOrderGate } from "@/lib/kyc/order-gate";
import { FOLLOW_UP_STATUSES, startConversation } from "@/lib/chats/conversations";
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from "@/lib/db-errors";
import { deriveOrderFields, derivePaymentStatus } from "@/lib/orders/derive";
import { allowedTransitions, transitionRequirements, validateTransition, type OrderStatus } from "@/lib/orders/transitions";
import { offerAcceptable } from "@/lib/orders/booking-readiness";
import { isReadyToDispatch } from "@/lib/orders/dispatch-readiness";
import { carrierSnapshot } from "@/lib/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@/lib/orders/commission";
import { getSheetsAccessToken } from "@/lib/orders/google-token";
import { currentOrderYear, maxSheetSeq, nextOrderId } from "@/lib/orders/order-id";
import { getRange } from "@/lib/orders/sheets-client";
import { HEADER_ROW, SHEET_NAME, resolveColumns } from "@/lib/orders/orders-sheet-mapping";
import { syncSheetsAndRecord } from "@/lib/orders/sheet-outbox";
import { changedCurrencyParties, partiesWithMoneyDocuments } from "@/lib/orders/note-currency";
import { changedPaymentParties, proofPaymentPatch, type PaymentSums } from "@/lib/orders/payments";
import { paymentSums } from "@/lib/orders/payment-sums";
import { diffChangedFields } from "@/lib/orders/order-facts";

import { listOffers } from "./offers-procedures";

/**
 * A leg's currency is what gives the stored note totals and proof-of-payment
 * sums their meaning, so it cannot be repointed once that party has live
 * notes or has ever had a proof — the totals would be silently
 * reinterpreted. Callers must have already loaded `current`.
 */
async function assertCurrencyUnlocked(
    db: typeof Database,
    patch: { shipperCurrency?: string | null; carrierCurrency?: string | null },
    current: { id: string; shipperCurrency: string | null; carrierCurrency: string | null },
) {
    const changing = changedCurrencyParties(patch, current);

    if (!changing.length) return;

    const locked = await partiesWithMoneyDocuments(db, current.id);

    if (changing.some((party) => locked.has(party))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_CURRENCY_LOCKED" });
    }
}

/**
 * A POP-governed leg derives its paid block from the recorded proofs, so a
 * hand edit of paid amount / payment status / full-payment date is rejected
 * rather than merged. Unchanged echoes of the stored values (a full-form
 * save) pass.
 */
function assertPaymentUnlocked(
    patch: Parameters<typeof changedPaymentParties>[0],
    current: Order,
    sums: PaymentSums,
) {
    if (changedPaymentParties(patch, current).some((party) => sums[party].governed)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "POP_PAYMENT_LOCKED" });
    }
}

/**
 * Domain failures travel as TRPCError with the domain code in `message`,
 * so the client can map them to translated copy.
 */
// The plate/driver columns reference the fleet registry; a violation means
// the typed value was not picked from (or registered into) it
const FK_ERROR_CODES = {
    truck_plate: "TRUCK_NOT_REGISTERED",
    trailer_plate: "TRAILER_NOT_REGISTERED",
    link_plate: "LINK_NOT_REGISTERED",
    driver_id: "DRIVER_NOT_REGISTERED",
} as const;

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
        const code =
            error.code === "UNAUTHORIZED" ? "UNAUTHORIZED"
                : error.code === "INSUFFICIENT_SCOPE" ? "FORBIDDEN"
                    : error.code === "GOOGLE_NOT_LINKED" || error.code === "HEADER_MISMATCH" ? "PRECONDITION_FAILED"
                        : "INTERNAL_SERVER_ERROR";

        return new TRPCError({ code, message: error.code, cause: error });
    }

    console.error("unexpected order failure", error);
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
}

const decimal = (value: number | undefined) => (value === undefined ? null : String(value));

/** The offer a create-shaped payload books with, or none for a prospect. */
const acceptedOfferOf = (input: CreateOrderForm) =>
    (input.status === "booked" ? input.offers.find((offer) => offer.accepted) : undefined);

/**
 * What a booking writes into its transition history row, so the timeline
 * can say WHICH offer booked the order and on what terms without joining
 * back to a row that may since have been re-priced.
 */
export type BookedOfferMetadata = {
    id: string;
    carrierName: string;
    total: number;
    currency: string;
    includesGit: boolean;
    includesGps: boolean;
};

const offerMetadata = (offer: OrderOffer): BookedOfferMetadata => ({
    id: offer.id,
    carrierName: offer.carrierName,
    total: Number(offer.total),
    currency: offer.currency,
    includesGit: offer.includesGit,
    includesGps: offer.includesGps,
});

function toInsertValues(
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

const isUniqueViolation = (error: unknown): boolean => uniqueViolationConstraint(error) !== null;

// Only Date-valued keys, so the same object can feed both the drizzle
// .set() clause and deriveOrderFields' patch parameter
type TransitionStamps = Partial<Record<
    | "arrivalAtLoading" | "actualLoadingDate" | "departureLoadingDate"
    | "departureFromBorder" | "arrivalAtBorder" | "arrivalAtOffloading"
    | "actualOffloadingDate" | "departureOffloadingDate",
    Date
>>;

/**
 * Milestone timestamps implied by a transition, stamped only when still
 * empty — arriving at the border IS the arrival time. Ops can correct the
 * exact time later through the edit form.
 */
function transitionStamps(current: Order, to: OrderStatus): TransitionStamps {
    const stamps: TransitionStamps = {};
    const now = new Date();

    switch (to) {
        case "at-loading":
            if (current.arrivalAtLoading === null) stamps.arrivalAtLoading = now;
            break;
        case "loading":
            if (current.actualLoadingDate === null) stamps.actualLoadingDate = now;
            break;
        case "on-route":
            if (current.status === "at-border" && current.departureFromBorder === null) {
                stamps.departureFromBorder = now;
            }
            if ((current.status === "loading" || current.status === "waiting-documents") && current.departureLoadingDate === null) {
                stamps.departureLoadingDate = now;
            }
            break;
        case "at-border":
            if (current.arrivalAtBorder === null) stamps.arrivalAtBorder = now;
            break;
        case "at-offloading":
            if (current.arrivalAtOffloading === null) stamps.arrivalAtOffloading = now;
            break;
        case "offloading":
            if (current.actualOffloadingDate === null) stamps.actualOffloadingDate = now;
            break;
        case "delivered":
            if (current.departureOffloadingDate === null) stamps.departureOffloadingDate = now;
            break;
    }

    return stamps;
}

/**
 * Booked/tracked side effect: open (or relink) the driver's follow-up
 * conversation. Skips silently when the order has no driver phone yet —
 * a booking rarely names a driver, and order.update opens the thread
 * when the phone arrives.
 */
async function startFollowUpChat(db: typeof Database, updated: Order, orderPk: string): Promise<void> {
    if (!updated.driverPhoneNumber) {
        return;
    }

    const { conversation, existing, relinked } = await startConversation(db, {
        driverName: updated.driverName ?? updated.driverPhoneNumber,
        driverPhone: updated.driverPhoneNumber,
        orderId: updated.orderId,
    });

    // Only real changes land in history — the hook now fires on every
    // tracked transition, and an untouched thread is not worth a row
    if (existing && !relinked) {
        return;
    }

    await db.insert(orderHistory).values({
        orderId: orderPk,
        actorUserId: null,
        kind: "system",
        metadata: { followUpChat: relinked ? "relinked" : "created", conversationId: conversation.id },
    });
}

/**
 * The one rule for where an interrupted (stopped/issue) order goes back to:
 * the last transition target outside the interrupt pair. Two callers
 * evaluate it — this module against the database, and `resumeFromHistory`
 * against rows already in memory — so the pair lives here together. A drift
 * between them would offer the operator a resume target the server refuses.
 */
const RESUME_EXCLUDED: OrderStatus[] = ["stopped", "issue"];

/**
 * The resume target read off an already-fetched timeline, newest first.
 * `toStatus` is null on rows that are not transitions, and SQL's NOT IN
 * drops those on its own — the explicit null check here is what keeps this
 * branch in step with the query below.
 */
export function resumeFromHistory(
    history: { kind: string; toStatus: string | null }[],
): OrderStatus | null {
    const found = history.find((entry) =>
        entry.kind === "transition"
        && entry.toStatus !== null
        && !RESUME_EXCLUDED.includes(entry.toStatus as OrderStatus));

    return (found?.toStatus as OrderStatus | undefined) ?? null;
}

/** The same rule against the database, for callers without the timeline. */
async function deriveResumeStatus(db: typeof Database, orderPk: string): Promise<OrderStatus | null> {
    const [row] = await db
        .select({ toStatus: orderHistory.toStatus })
        .from(orderHistory)
        .where(and(
            eq(orderHistory.orderId, orderPk),
            eq(orderHistory.kind, "transition"),
            notInArray(orderHistory.toStatus, RESUME_EXCLUDED),
        ))
        .orderBy(desc(orderHistory.createdAt))
        .limit(1);

    return row?.toStatus ?? null;
}

/**
 * The bay type only lives on the fleet registry; the trailer's bay wins over
 * the truck's — same precedence the create form applies when picking vehicles.
 */
async function lookupLoadingBay(db: typeof Database, row: Order): Promise<LoadingBay["type"] | null> {
    const source = row.trailerPlate
        ? { table: trailer, plate: row.trailerPlate }
        : row.truckPlate
            ? { table: truck, plate: row.truckPlate }
            : null;

    if (source === null) {
        return null;
    }

    const [vehicle] = await db
        .select({ loadingBay: source.table.loadingBay })
        .from(source.table)
        .where(eq(source.table.regPlate, source.plate));

    return vehicle?.loadingBay?.type ?? null;
}

/**
 * How many offers on a row are still awaiting a decision, as a correlated
 * subquery — the orders list and the transition options both need it next
 * to the order's own columns.
 *
 * The conditions go in as drizzle expressions rather than as bare columns:
 * a `PgColumn` interpolated directly into a selection-field template loses
 * its table prefix when the query has no joins, which would bind
 * `order_id`/`status` to the wrong table. A nested SQL object is left
 * alone and renders fully qualified.
 */
export const pendingOfferCount = sql<number>`(
    select count(*) from ${orderOffer}
    where ${and(eq(orderOffer.orderId, order.id), eq(orderOffer.status, "pending"))}
)`.mapWith(Number);

/**
 * Books an order on one of its carrier offers: the single door every
 * booking goes through (creation with an accepted offer, the deal form,
 * and the prospect → booked transition), so the carrier leg and the
 * commission can never depend on which one was used.
 *
 * Returns the columns to fold into the order's own update, the metadata
 * the history row carries, and `settle` — the offer-side writes. They are
 * split because neon-http has no interactive transaction: the caller
 * writes the order row first and settles the offers only once it landed,
 * so a failure leaves a prospect with its offers still pending rather than
 * an accepted offer nothing booked.
 */
export async function acceptOffer(
    db: typeof Database,
    current: Order,
    offer: OrderOffer,
    actor: { userId: string },
    opts?: { note?: string },
): Promise<{ patch: Partial<CreateOrder>; historyOffer: BookedOfferMetadata; settle: () => Promise<void> }> {
    // An offer id from another order would book a carrier that never
    // quoted for this cargo
    if (offer.orderId !== current.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
    }

    if (offerAcceptable(offer) !== "ok") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
    }

    // The offer was priced when it was written — its commission and the
    // client price it quotes are what the order is booked at. A row from
    // before pricing existed is priced through the offer dialog first.
    if (offer.commissionTotal === null || offer.clientTotal === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_UNPRICED" });
    }

    const patch: Partial<CreateOrder> = {
        carrierId: offer.carrierId,
        carrierName: offer.carrierName,
        fiscalRegime: offer.fiscalRegime,
        carrierSubtotal: offer.subtotal,
        carrierVAT: offer.vat,
        carrierTotal: offer.total,
        carrierCurrency: offer.currency,
        // The client price the offer quotes becomes the shipper leg, in the
        // offer's currency: the price the shipper was shown is the price the
        // order is booked at, whatever the row carried before
        shipperSubtotal: offer.clientSubtotal,
        shipperVAT: offer.clientVAT,
        shipperTotal: offer.clientTotal,
        shipperCurrency: offer.currency,
        apploadCommissionSubtotal: offer.commissionSubtotal,
        apploadCommissionVAT: offer.commissionVAT,
        apploadCommissionTotal: offer.commissionTotal,
        // A driver and a rig belong to the carrier that named them, so a
        // re-booking with someone else starts from an empty cab
        ...(current.carrierId && current.carrierId !== offer.carrierId && {
            driverId: null,
            driverName: null,
            driverPhoneNumber: null,
            driverPassport: null,
            truckPlate: null,
            trailerPlate: null,
            linkPlate: null,
            truckAge: null,
        }),
    };

    const settle = async () => {
        const now = new Date();

        // One batch, so the winner and the losers are decided together.
        // The second statement sees the first's write, which is why it
        // does not have to exclude the accepted row by id.
        await db.batch([
            db
                .update(orderOffer)
                .set({
                    status: "accepted",
                    decidedAt: now,
                    decidedBy: actor.userId,
                    decisionNote: opts?.note ?? null,
                })
                .where(eq(orderOffer.id, offer.id)),
            db
                .update(orderOffer)
                .set({ status: "lost", decidedAt: now })
                .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "pending"))),
        ]);
    };

    return { patch, historyOffer: offerMetadata(offer), settle };
}

/**
 * Brings a prospect's PENDING offers in line with a deal-form payload:
 * rows carrying an id are re-priced, rows without one are added with a
 * fresh carrier snapshot, and pending rows the payload dropped are
 * deleted. The `status = pending` guard is what protects the record — a
 * decided offer never travels with the form, and one decided between load
 * and save is silently left alone rather than resurrected.
 *
 * Returns the id of the offer the payload marked accepted (its own, or
 * the one just inserted for it), which is what the booking then accepts.
 */
async function syncDealOffers(
    db: typeof Database,
    orderPk: string,
    offers: CreateOrderForm["offers"],
    userId: string,
    route: CreateOrderForm["routeType"],
): Promise<string | null> {
    const keptIds = offers.map((offer) => offer.id).filter((id): id is string => id !== undefined);

    await db
        .delete(orderOffer)
        .where(and(
            eq(orderOffer.orderId, orderPk),
            eq(orderOffer.status, "pending"),
            keptIds.length > 0 ? notInArray(orderOffer.id, keptIds) : undefined,
        ));

    let acceptedId: string | null = null;

    for (const offer of offers) {
        const values = {
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
            // Priced against the route the same save carries, like the
            // offers router prices against the stored one
            ...offerPricingColumns(priceOffer({
                carrierTotal: offer.total,
                fiscalRegime: offer.fiscalRegime,
                commissionTotal: offer.commissionTotal,
                route,
            })),
        };

        if (offer.id !== undefined) {
            // Scoped to this order like the delete above: an id is client
            // data, and one belonging to another order would be re-priced
            // here long before the booking's ownership check sees it
            const [stored] = await db
                .select({ carrierId: orderOffer.carrierId })
                .from(orderOffer)
                .where(and(eq(orderOffer.id, offer.id), eq(orderOffer.orderId, orderPk)));

            // A different carrier is a different track record, so the frozen
            // snapshot follows it — the rule offers.update already applies
            const moved = stored !== undefined && stored.carrierId !== offer.carrierId
                ? await carrierSnapshot(db, offer.carrierId)
                : null;

            await db
                .update(orderOffer)
                .set({ ...values, ...(moved && { carrierSince: moved.since, carrierTrips: moved.trips }) })
                .where(and(
                    eq(orderOffer.orderId, orderPk),
                    eq(orderOffer.id, offer.id),
                    eq(orderOffer.status, "pending"),
                ));

            if (offer.accepted) acceptedId = offer.id;
            continue;
        }

        const snapshot = await carrierSnapshot(db, offer.carrierId);

        const [inserted] = await db
            .insert(orderOffer)
            .values({
                orderId: orderPk,
                ...values,
                carrierSince: snapshot.since,
                carrierTrips: snapshot.trips,
                createdBy: userId,
            })
            .returning({ id: orderOffer.id });

        if (offer.accepted && inserted) acceptedId = inserted.id;
    }

    return acceptedId;
}

export type CreateOrderOutput = {
    orderId: string;
    status: Order["status"];
    order: Order;
    warning?: "SHEET_FAILED";
};

export type UpdateOrderOutput = {
    orderId: string;
    order: Order;
    loadingBay: LoadingBay["type"] | null;
    warning?: "SHEET_FAILED";
};

export type TransitionOrderOutput = {
    orderId: string;
    order: Order;
    warning?: "SHEET_FAILED";
};

export const TransitionSchema = z.object({
    orderId: z.string(),
    to: z.enum(ORDER_STATUS),
    expectedVersion: z.number().int().min(1),
    note: z.string().trim().min(5).max(2000).optional(),
    // The carrier offer prospect → booked accepts; ignored by every other
    // move, since booking is the only one that commits a carrier
    offerId: z.string().optional(),
    // Evidence/POD upload backing the move (EdgeStore URL). The
    // document row itself is created by the documents router;
    // here it also lands in the history metadata.
    document: z.object({
        url: z.url(),
        name: z.string().max(200).optional(),
        size: z.number().int().optional(),
        mimeType: z.string().max(100).optional(),
    }).optional(),
});

export type TransitionInput = z.infer<typeof TransitionSchema>;

// What a transition needs from the request: the caller's session and role,
// the database, and the auth handles the Sheets token is minted from
export type TransitionContext = {
    db: typeof Database;
    session: { user: { id: string } };
    staff: { role: StaffRole };
    authApi: Auth["api"];
    headers: Headers;
    waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * The one door for status changes, shared by the single-order mutation and
 * the bulk one. Validates the move against the declarative state machine
 * (current status + route + actor role), enforces the payload the move
 * demands (note / evidence / POD), refuses to close a disputed order,
 * stamps implied milestone dates, applies the derived side effects (booked
 * payment scaffolding, dealDate, podStatus...), raises the review flag on
 * risky moves, and appends the history row. Throws TRPCErrors with domain
 * codes; the callers map anything else through toTRPCError.
 *
 * `options.accessToken` lets a batch mint the Sheets token once; `null`
 * means the caller already failed to get one.
 */
export async function transitionOrder(
    ctx: TransitionContext,
    input: TransitionInput,
    options: { accessToken?: string | null } = {},
): Promise<TransitionOrderOutput> {
    const [current] = await ctx.db
        .select()
        .from(order)
        .where(eq(order.orderId, input.orderId));

    if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    // Closing an order as lost (cancelled or underbid) is its own
    // permission on top of transition
    if ((input.to === "cancelled" || input.to === "underbid") && !isAuthorized(ctx.staff.role, "order", ["cancel"])) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
    }

    // Booking a prospect is the acceptance of one of its carrier
    // offers, and nothing else: the carrier, the fiscal regime, the
    // carrier price and the commission are all copied from that offer
    // onto the order. Nothing is written yet — the offers are settled
    // once the row itself has landed.
    let booked: { offer: OrderOffer; accepted: Awaited<ReturnType<typeof acceptOffer>> } | null = null;

    if (input.to === "booked" && current.status === "prospect") {
        if (!input.offerId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_REQUIRED" });
        }

        const [offer] = await ctx.db
            .select()
            .from(orderOffer)
            .where(eq(orderOffer.id, input.offerId));

        // A deleted offer reads the same as a decided one: it is no
        // longer awaiting a decision, so it cannot book anything
        if (!offer) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
        }

        // The offer repoints both legs' currencies; a leg that already
        // carries notes or proofs (a reverted booking) cannot be
        // silently reinterpreted
        await assertCurrencyUnlocked(
            ctx.db,
            { shipperCurrency: offer.currency, carrierCurrency: offer.currency },
            current,
        );

        booked = {
            offer,
            accepted: await acceptOffer(ctx.db, current, offer, { userId: ctx.session.user.id }, { note: input.note }),
        };
    }

    // Driver and truck are optional at booking — a trip is committed
    // weeks before the rig that will run it is known — and mandatory
    // the moment it is dispatched to the loading site
    if (input.to === "to-loading" && !isReadyToDispatch(current)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INCOMPLETE_FOR_DISPATCH" });
    }

    // The cargo cannot be closed while a dispute over it is open; the
    // dispute is settled or closed first, which lifts this
    if (input.to === "completed" && isActiveDispute(current.disputeStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_OPEN" });
    }

    // Verification is checked once per thing committed: the carrier at
    // booking, where it comes off the offer because the row does not
    // carry one yet, and the driver and the rig at dispatch, which is
    // the first moment they exist. Later transitions move an order
    // that was already gated on both.
    const { flagPatch: gateFlag } = booked
        ? await guardOrderGate(
            ctx.db,
            { carrierId: booked.offer.carrierId },
            { role: ctx.staff.role, actorId: ctx.session.user.id, note: input.note },
        )
        : input.to === "to-loading" && current.carrierId
            ? await guardOrderGate(
                ctx.db,
                {
                    carrierId: current.carrierId,
                    driverId: current.driverId,
                    truckPlate: current.truckPlate,
                    trailerPlate: current.trailerPlate,
                    linkPlate: current.linkPlate,
                },
                { role: ctx.staff.role, actorId: ctx.session.user.id, note: input.note },
            )
            : { flagPatch: null };

    const resumeStatus =
        current.status === "stopped" || current.status === "issue"
            ? await deriveResumeStatus(ctx.db, current.id)
            : null;

    const verdict = validateTransition(
        { status: current.status, route: current.route, role: ctx.staff.role, resumeStatus },
        input.to,
    );

    if (!verdict.ok) {
        throw new TRPCError({
            code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "BAD_REQUEST",
            message: verdict.code,
        });
    }

    if (verdict.requirements.includes("note") && !input.note) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_REQUIRED" });
    }
    if (verdict.requirements.includes("evidence") && !input.document) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "EVIDENCE_REQUIRED" });
    }
    if (verdict.requirements.includes("pod") && !input.document) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "POD_REQUIRED" });
    }

    const flag = verdict.requirements.includes("flag");
    const stamps = transitionStamps(current, input.to);
    const payments = await paymentSums(ctx.db, current.id);

    // The carrier leg arrives WITH the offer, in this very update, so both
    // derivations have to be told about it rather than read it off the row:
    // `current` is the prospect that had no carrier total — or, on a
    // re-booking, still carries the PREVIOUS carrier's. They price that leg
    // (the booked payment scaffold and the proof block), and the deal-form
    // booking door passes exactly the same pair.
    const bookedCarrier = booked
        ? {
            fiscalRegime: booked.offer.fiscalRegime,
            carrierTotal: Number(booked.offer.total),
            ...(booked.offer.clientTotal !== null && { shipperTotal: Number(booked.offer.clientTotal) }),
        }
        : undefined;

    const [updated] = await ctx.db
        .update(order)
        .set({
            ...stamps,
            status: input.to,
            ...(input.to === "delivered" && current.podStatus === null && {
                podStatus: "pending-collection" as const,
            }),
            // The accepted offer's carrier leg and commission. The derived
            // columns below re-split the same total under the same rule, so
            // they land on identical numbers; what only this patch carries
            // is the carrier identity and the empty cab of a carrier change.
            ...booked?.accepted.patch,
            // A verification flag outranks a transition one: its
            // reason names the specific gap, where the transition
            // flag only carries the operator's note
            ...gateFlag,
            ...(flag && !gateFlag && {
                flaggedForReview: true,
                flagReason: input.note ?? null,
                flaggedAt: new Date(),
                flaggedBy: ctx.session.user.id,
            }),
            // Derived columns (dealDate, payment scaffolding,
            // loaded/offloaded weight, day counters) win last
            ...deriveOrderFields(current, { status: input.to, ...stamps, ...bookedCarrier }),
            // ...except on POP-governed legs, where the recorded
            // proofs beat the booked "pending" scaffold and the
            // prospect/cancelled rules apply to the NEW status
            ...proofPaymentPatch(
                { ...current, status: input.to, ...(booked && { carrierTotal: booked.offer.total, shipperTotal: booked.offer.clientTotal }) },
                payments,
            ),
            version: sql`${order.version} + 1`,
        })
        .where(and(
            eq(order.id, current.id),
            eq(order.version, input.expectedVersion),
        ))
        .returning();

    if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
    }

    // The offer side of the move, written only now that the row itself
    // landed: a failure here leaves a correct order with stale offer
    // bookkeeping, never a carrier no offer accounts for
    if (booked) {
        await booked.accepted.settle();
    } else if (current.status === "booked" && input.to === "prospect") {
        // Un-booking releases the carrier: its offer is withdrawn, and
        // booking again means accepting a new one. The quotes registered
        // while the order was booked stay `recorded`: they are Appload's
        // data, never candidates, so a replacement carrier is entered as a
        // fresh pending offer on the prospect.
        await ctx.db
            .update(orderOffer)
            .set({
                status: "withdrawn",
                decidedAt: new Date(),
                decidedBy: ctx.session.user.id,
                decisionNote: input.note ?? null,
            })
            .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "accepted")));
    } else if (current.status === "prospect" && (input.to === "cancelled" || input.to === "underbid")) {
        // The quote died; nobody won it
        await ctx.db
            .update(orderOffer)
            .set({ status: "lost", decidedAt: new Date() })
            .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "pending")));
    }

    await ctx.db.insert(orderHistory).values({
        orderId: current.id,
        actorUserId: ctx.session.user.id,
        kind: "transition",
        fromStatus: current.status,
        toStatus: input.to,
        metadata: {
            ...(input.note && { note: input.note }),
            ...(flag && { flagged: true }),
            ...(input.document && { document: input.document }),
            ...(booked && { offer: booked.accepted.historyOffer }),
        },
    });

    // The upload that backed the move becomes a first-class
    // document on the order (POD for completion, evidence for
    // cancels), so it shows up in the documents section
    if (input.document && (verdict.requirements.includes("pod") || verdict.requirements.includes("evidence"))) {
        await ctx.db.insert(orderDocument).values({
            orderId: current.id,
            type: verdict.requirements.includes("pod") ? "pod" : "evidence",
            title: input.document.name ?? null,
            url: input.document.url,
            size: input.document.size ?? null,
            mimeType: input.document.mimeType ?? null,
            reason: input.note ?? null,
            uploadedBy: ctx.session.user.id,
        });
    }

    // Booked and tracked orders get a follow-up chat with the
    // driver. Post-response and best-effort: a chat/Infobip
    // failure must never fail the transition. Nothing logs the
    // no-phone skip any more — a booking has no driver yet by
    // design, so the row would land on every single one; the
    // thread opens from order.update when the phone arrives.
    if (FOLLOW_UP_STATUSES.includes(input.to)) {
        const followUp = startFollowUpChat(ctx.db, updated, current.id)
            .catch((error: unknown) => console.error(`follow-up chat failed for ${input.orderId}`, error));

        if (ctx.waitUntil) ctx.waitUntil(followUp); else await followUp;
    }

    try {
        const accessToken = options.accessToken === undefined
            ? await getSheetsAccessToken(ctx.authApi, ctx.headers, ctx.session.user.id)
            : options.accessToken;

        if (accessToken === null || !await syncSheetsAndRecord(ctx.db, accessToken, updated)) {
            return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
        }
    } catch (error) {
        // Token acquisition failed — the outbox cron retries with
        // the service account
        console.error(`sheet sync failed on transition for ${input.orderId}`, error);
        return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
    }

    return { orderId: input.orderId, order: updated };
}

export const orderRouter = createTRPCRouter({
    create: authorizedProcedure("order", ["create"])
        .input(CreateOrderSchemaServer)
        .mutation(async ({ ctx, input }): Promise<CreateOrderOutput> => {
            try {
                const userId = ctx.session.user.id;
                const accepted = acceptedOfferOf(input);

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
                        { role: ctx.staff.role, actorId: userId },
                    )
                    : { flagPatch: null };

                const accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, userId);

                // Refuse to write into a sheet whose columns were changed
                const [headerRow] = await getRange(accessToken, SHEET_NAME, `${HEADER_ROW}:${HEADER_ROW}`);
                resolveColumns(headerRow ?? []);

                const year = currentOrderYear();
                const sheetSeq = maxSheetSeq(await getRange(accessToken, SHEET_NAME, "A:A"), year);

                const dbMaxSeq = async () => {
                    const [row] = await ctx.db
                        .select({ value: max(order.seq) })
                        .from(order)
                        .where(eq(order.year, year));

                    return row?.value ?? 0;
                };

                // The unique (year, seq) index arbitrates concurrent creates:
                // retry once with a recomputed sequence if another create won
                let saved: Order | undefined;

                for (let attempt = 0; attempt < 2 && !saved; attempt++) {
                    const id = nextOrderId(await dbMaxSeq(), sheetSeq, year);

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
                if (!await syncSheetsAndRecord(ctx.db, accessToken, saved)) {
                    return { orderId: saved.orderId, status: saved.status, order: saved, warning: "SHEET_FAILED" };
                }

                return { orderId: saved.orderId, status: saved.status, order: saved };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    update: authorizedProcedure("order", ["update"])
        .input(
            z.object({
                orderId: z.string(),
                // Concurrency guard: the version the client loaded. A stale
                // version means someone else edited in between — 409, never
                // a silent last-write-wins.
                expectedVersion: z.number().int().min(1),
                patch: UpdateOrderSchemaServer,
            }),
        )
        .mutation(async ({ ctx, input }): Promise<UpdateOrderOutput> => {
            try {
                // Status changes travel exclusively through order.transition,
                // where the state machine guards them
                if (input.patch.status !== undefined) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "USE_TRANSITION" });
                }

                // The carrier is not typed onto an order either: it is
                // copied from the offer the order books with, so changing
                // it means moving back to prospect and accepting another
                // one. Carrier MONEY stays editable here — invoices,
                // notes and payments are their own reality.
                if (input.patch.carrierId !== undefined || input.patch.carrierName !== undefined) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "USE_OFFER" });
                }

                const accessToken = await getSheetsAccessToken(
                    ctx.authApi,
                    ctx.headers,
                    ctx.session.user.id,
                );

                // Derivations need the merged state (stored row + patch): a
                // patch may carry only one of the dates a rule depends on
                const [current] = await ctx.db
                    .select()
                    .from(order)
                    .where(eq(order.orderId, input.orderId));

                if (!current) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                const data = input.patch;

                await assertCurrencyUnlocked(ctx.db, data, current);

                // POP-governed legs derive their paid block from the recorded
                // proofs: hand edits are rejected and the block is re-derived
                // below against the patched totals
                const payments = await paymentSums(ctx.db, current.id);
                assertPaymentUnlocked(data, current, payments);

                const [updated] = await ctx.db
                    .update(order)
                    .set({
                        ...(data.loadingAddress !== undefined && { loadingAddress: data.loadingAddress }),
                        ...(data.expectedLoadingDate !== undefined && { expectedLoadingDate: data.expectedLoadingDate }),
                        ...(data.proposedLoadingDate !== undefined && { proposedLoadingDate: data.proposedLoadingDate }),
                        ...(data.arrivalAtLoading !== undefined && { arrivalAtLoading: data.arrivalAtLoading }),
                        ...(data.actualLoadingDate !== undefined && { actualLoadingDate: data.actualLoadingDate }),
                        ...(data.departureLoadingDate !== undefined && { departureLoadingDate: data.departureLoadingDate }),
                        ...(data.demurrageChargedAtLoading !== undefined && { demurrageChargedAtLoading: data.demurrageChargedAtLoading }),
                        ...(data.demurrageChargedDaysAtLoading !== undefined && { demurrageChargedDaysAtLoading: data.demurrageChargedDaysAtLoading }),
                        ...(data.offloadingAddress !== undefined && { offloadingAddress: data.offloadingAddress }),
                        ...(data.expectedOffloadingDate !== undefined && { expectedOffloadingDate: data.expectedOffloadingDate }),
                        ...(data.proposedOffloadingDate !== undefined && { proposedOffloadingDate: data.proposedOffloadingDate }),
                        ...(data.arrivalAtOffloading !== undefined && { arrivalAtOffloading: data.arrivalAtOffloading }),
                        ...(data.actualOffloadingDate !== undefined && { actualOffloadingDate: data.actualOffloadingDate }),
                        ...(data.departureOffloadingDate !== undefined && { departureOffloadingDate: data.departureOffloadingDate }),
                        ...(data.demurrageChargedAtOffloading !== undefined && { demurrageChargedAtOffloading: data.demurrageChargedAtOffloading }),
                        ...(data.demurrageChargedDaysAtOffloading !== undefined && { demurrageChargedDaysAtOffloading: data.demurrageChargedDaysAtOffloading }),
                        ...(data.arrivalAtBorder !== undefined && { arrivalAtBorder: data.arrivalAtBorder }),
                        ...(data.departureFromBorder !== undefined && { departureFromBorder: data.departureFromBorder }),
                        ...(data.demurrageChargedAtBorder !== undefined && { demurrageChargedAtBorder: data.demurrageChargedAtBorder }),
                        ...(data.demurrageChargedDaysAtBorder !== undefined && { demurrageChargedDaysAtBorder: data.demurrageChargedDaysAtBorder }),
                        ...(data.distance !== undefined && { distance: data.distance }),
                        ...(data.expectedTrucks !== undefined && { expectedTrucks: data.expectedTrucks }),
                        ...(data.route !== undefined && { route: data.route }),
                        ...(data.tripType !== undefined && { tripType: data.tripType }),
                        ...(data.deliveries !== undefined && { deliveries: data.deliveries }),
                        ...(data.category !== undefined && { category: data.category }),
                        ...(data.description !== undefined && { description: data.description }),
                        ...(data.weight !== undefined && { weight: String(data.weight) }),
                        ...(data.loadedWeight !== undefined && { loadedWeight: decimal(data.loadedWeight) }),
                        ...(data.offloadedWeight !== undefined && { offloadedWeight: decimal(data.offloadedWeight) }),
                        ...(data.weightUnit !== undefined && { weightUnit: data.weightUnit }),
                        ...(data.packing !== undefined && { packing: data.packing }),
                        ...(data.isHazardous !== undefined && { isHazardous: data.isHazardous }),
                        ...(data.hazchemCode !== undefined && { hazchemCode: data.hazchemCode || null }),
                        ...(data.isRefrigerated !== undefined && { isRefrigerated: data.isRefrigerated }),
                        ...(data.temperature !== undefined && { temperature: decimal(data.temperature) }),
                        ...(data.temperatureInstructions !== undefined && { temperatureInstructions: data.temperatureInstructions || null }),
                        ...(data.loadType !== undefined && { loadType: data.loadType }),
                        ...(data.podStatus !== undefined && { podStatus: data.podStatus }),
                        ...(data.fiscalRegime !== undefined && { fiscalRegime: data.fiscalRegime }),
                        ...(data.truckPlate !== undefined && { truckPlate: data.truckPlate }),
                        ...(data.trailerPlate !== undefined && { trailerPlate: data.trailerPlate || null }),
                        ...(data.linkPlate !== undefined && { linkPlate: data.linkPlate || null }),
                        ...(data.truckAge !== undefined && { truckAge: data.truckAge }),
                        ...(data.driverName !== undefined && { driverName: data.driverName }),
                        ...(data.driverId !== undefined && { driverId: data.driverId || null }),
                        ...(data.driverPhoneNumber !== undefined && { driverPhoneNumber: data.driverPhoneNumber || null }),
                        ...(data.driverPassport !== undefined && { driverPassport: data.driverPassport || null }),
                        ...(data.carrierInvoiceNumber !== undefined && { carrierInvoiceNumber: data.carrierInvoiceNumber || null }),
                        ...(data.carrierInvoiceDate !== undefined && { carrierInvoiceDate: data.carrierInvoiceDate }),
                        ...(data.carrierSubtotal !== undefined && { carrierSubtotal: decimal(data.carrierSubtotal) }),
                        ...(data.carrierVAT !== undefined && { carrierVAT: decimal(data.carrierVAT) }),
                        ...(data.carrierTotal !== undefined && { carrierTotal: decimal(data.carrierTotal) }),
                        ...(data.carrierCurrency !== undefined && { carrierCurrency: data.carrierCurrency }),
                        ...(data.carrierPaidAmount !== undefined && { carrierPaidAmount: decimal(data.carrierPaidAmount) }),
                        ...(data.carrierPaymentStatus !== undefined && { carrierPaymentStatus: data.carrierPaymentStatus }),
                        ...(data.carrierFullPaymentDate !== undefined && { carrierFullPaymentDate: data.carrierFullPaymentDate }),
                        ...(data.insuranceSubscriber !== undefined && { insuranceSubscriber: data.insuranceSubscriber || null }),
                        ...(data.insuranceValue !== undefined && { insuranceValue: decimal(data.insuranceValue) }),
                        ...(data.insuranceCurrency !== undefined && { insuranceCurrency: data.insuranceCurrency }),
                        ...(data.insuranceStatus !== undefined && { insuranceStatus: data.insuranceStatus }),
                        ...(data.apploadCommissionSubtotal !== undefined && { apploadCommissionSubtotal: decimal(data.apploadCommissionSubtotal) }),
                        ...(data.apploadCommissionVAT !== undefined && { apploadCommissionVAT: decimal(data.apploadCommissionVAT) }),
                        ...(data.apploadCommissionTotal !== undefined && { apploadCommissionTotal: decimal(data.apploadCommissionTotal) }),
                        ...(data.shipperInvoiceNumber !== undefined && { shipperInvoiceNumber: data.shipperInvoiceNumber || null }),
                        ...(data.shipperInvoiceDate !== undefined && { shipperInvoiceDate: data.shipperInvoiceDate }),
                        ...(data.shipperSubtotal !== undefined && { shipperSubtotal: decimal(data.shipperSubtotal) }),
                        ...(data.shipperVAT !== undefined && { shipperVAT: decimal(data.shipperVAT) }),
                        ...(data.shipperTotal !== undefined && { shipperTotal: decimal(data.shipperTotal) }),
                        ...(data.shipperCurrency !== undefined && { shipperCurrency: data.shipperCurrency }),
                        ...(data.shipperReceivedAmount !== undefined && { shipperReceivedAmount: decimal(data.shipperReceivedAmount) }),
                        ...(data.shipperPaymentStatus !== undefined && { shipperPaymentStatus: data.shipperPaymentStatus }),
                        ...(data.shipperFullPaymentDate !== undefined && { shipperFullPaymentDate: data.shipperFullPaymentDate }),
                        ...(data.numberOfMechanicalFailuresStops !== undefined && { numberOfMechanicalFailuresStops: data.numberOfMechanicalFailuresStops }),
                        ...(data.totalMechanicalFailuresDelayedDays !== undefined && { totalMechanicalFailuresDelayedDays: data.totalMechanicalFailuresDelayedDays }),
                        ...(data.numberOfDocumentationIssuesStops !== undefined && { numberOfDocumentationIssuesStops: data.numberOfDocumentationIssuesStops }),
                        ...(data.totalDocumentationIssuesDelayedDays !== undefined && { totalDocumentationIssuesDelayedDays: data.totalDocumentationIssuesDelayedDays }),
                        ...(data.numberOfPoliceStops !== undefined && { numberOfPoliceStops: data.numberOfPoliceStops }),
                        ...(data.totalPoliceDelayedDays !== undefined && { totalPoliceDelayedDays: data.totalPoliceDelayedDays }),
                        ...(data.numberAccidents !== undefined && { numberAccidents: data.numberAccidents }),
                        ...(data.cargoDamaged !== undefined && { cargoDamaged: data.cargoDamaged }),
                        ...(data.damagedPercent !== undefined && { damagedPercent: decimal(data.damagedPercent) }),
                        ...(data.claimed !== undefined && { claimed: data.claimed }),
                        ...(data.ageFactor !== undefined && { ageFactor: decimal(data.ageFactor) }),
                        ...(data.loadFactor !== undefined && { loadFactor: decimal(data.loadFactor) }),
                        ...(data.defaultCoefficient !== undefined && { defaultCoefficient: decimal(data.defaultCoefficient) }),
                        ...(data.costPerKm !== undefined && { costPerKm: decimal(data.costPerKm) }),
                        ...(data.costPerUnit !== undefined && { costPerUnit: decimal(data.costPerUnit) }),
                        ...(data.costPerUnitKm !== undefined && { costPerUnitKm: decimal(data.costPerUnitKm) }),
                        ...(data.totalFuelCost !== undefined && { totalFuelCost: decimal(data.totalFuelCost) }),
                        // Derived columns win over anything in the patch
                        ...deriveOrderFields(current, data),
                        // POP-governed legs: the recorded proofs are the truth
                        // for paid/remaining/status, so they beat both the
                        // patch and deriveOrderFields' completed/pending
                        // shortcuts — derived against the patched totals
                        ...proofPaymentPatch({
                            ...current,
                            shipperTotal: data.shipperTotal !== undefined ? decimal(data.shipperTotal) : current.shipperTotal,
                            carrierTotal: data.carrierTotal !== undefined ? decimal(data.carrierTotal) : current.carrierTotal,
                        }, payments),
                        version: sql`${order.version} + 1`,
                    })
                    .where(and(
                        eq(order.orderId, input.orderId),
                        eq(order.version, input.expectedVersion),
                    ))
                    .returning();

                // The row exists (loaded above), so zero affected rows means
                // a concurrent writer bumped the version first (a proof of
                // payment recorded meanwhile lands here too)
                if (!updated) {
                    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
                }

                const changedFields = diffChangedFields(current, data);

                if (Object.keys(changedFields).length > 0) {
                    await ctx.db.insert(orderHistory).values({
                        orderId: current.id,
                        actorUserId: ctx.session.user.id,
                        kind: "update",
                        changedFields,
                    });
                }

                // A driver phone landing on an already booked/tracked order
                // opens the follow-up thread the booked transition skipped
                // (or reroutes it to the corrected number). Best-effort,
                // like the transition hook.
                const phoneAdded = updated.driverPhoneNumber !== null
                    && updated.driverPhoneNumber !== current.driverPhoneNumber;

                if (phoneAdded && FOLLOW_UP_STATUSES.includes(updated.status)) {
                    const followUp = startFollowUpChat(ctx.db, updated, current.id)
                        .catch((error: unknown) => console.error(`follow-up chat failed for ${input.orderId}`, error));

                    if (ctx.waitUntil) ctx.waitUntil(followUp); else await followUp;
                }

                // Resolved after the write so plate changes in this same
                // patch are reflected; the client fills the PDF templates
                // from the returned row + bay type
                const loadingBay = await lookupLoadingBay(ctx.db, updated);

                if (!await syncSheetsAndRecord(ctx.db, accessToken, updated)) {
                    return { orderId: input.orderId, order: updated, loadingBay, warning: "SHEET_FAILED" };
                }

                return { orderId: input.orderId, order: updated, loadingBay };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Full edit of a PROSPECT through the create-shaped payload — the same
     * schema (and the same offer refines) creation runs, so booking from
     * here can never dodge the validation creation applies. The payload
     * also owns the prospect's pending offers; when it marks one accepted,
     * the booking (history row, payment scaffolding, follow-up chat) rides
     * in the same write.
     *
     * A booked order is past this door: it edits through order.update's
     * tabbed patch form, and its status moves only via order.transition.
     */
    updateDeal: authorizedProcedure("order", ["update"])
        .input(
            z.object({
                orderId: z.string(),
                expectedVersion: z.number().int().min(1),
                values: CreateOrderSchemaServer,
            }),
        )
        .mutation(async ({ ctx, input }): Promise<UpdateOrderOutput> => {
            try {
                const [current] = await ctx.db
                    .select()
                    .from(order)
                    .where(eq(order.orderId, input.orderId));

                if (!current) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }
                // Only a prospect edits through this door; everything from
                // booked onward uses the tabbed patch form and transitions
                if (current.status !== "prospect") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATE" });
                }
                // The offers are written before the row's own optimistic
                // lock is taken (the booking has to accept a stored row),
                // so a stale form is refused here rather than after its
                // offer edits landed. The lock on the update still stands.
                if (current.version !== input.expectedVersion) {
                    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
                }

                const booking = input.values.status === "booked";
                const acceptedInput = acceptedOfferOf(input.values);

                // The carrier leg's currency arrives with the offer this
                // payload books with, not as a field of its own
                await assertCurrencyUnlocked(
                    ctx.db,
                    { shipperCurrency: input.values.shipperCurrency, carrierCurrency: acceptedInput?.currency },
                    current,
                );

                if (booking && !isAuthorized(ctx.staff.role, "order", ["transition"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }

                // Same gate as create, at the moment the deal is committed
                const { flagPatch } = acceptedInput
                    ? await guardOrderGate(
                        ctx.db,
                        {
                            carrierId: acceptedInput.carrierId,
                            driverId: input.values.driverId,
                            truckPlate: input.values.truckPlate,
                            trailerPlate: input.values.trailerPlate,
                            linkPlate: input.values.linkPlate,
                        },
                        { role: ctx.staff.role, actorId: ctx.session.user.id },
                    )
                    : { flagPatch: null };

                // The form owns the prospect's pending offers, so they are
                // brought in line first — the booking below has to accept a
                // STORED row, including one this payload just added
                const acceptedId = await syncDealOffers(ctx.db, current.id, input.values.offers, ctx.session.user.id, input.values.routeType);

                let accepted: Awaited<ReturnType<typeof acceptOffer>> | null = null;

                if (booking) {
                    if (acceptedId === null) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_REQUIRED" });
                    }

                    const [offer] = await ctx.db
                        .select()
                        .from(orderOffer)
                        .where(eq(orderOffer.id, acceptedId));

                    if (!offer) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
                    }

                    // Only its verdict, its settlement and its history
                    // metadata are used here: the payload is a full form
                    // snapshot, so the carrier leg and the commission below
                    // already come from this same offer through the
                    // schema's transform.
                    accepted = await acceptOffer(
                        ctx.db,
                        current,
                        offer,
                        { userId: ctx.session.user.id },
                    );
                }

                const accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, ctx.session.user.id);

                // Same column mapping as creation, minus identity/authorship
                // and the payment statuses (create derives them from scratch;
                // here deriveOrderFields governs, which never downgrades a
                // partially/completed payment). A prospect is still a quote,
                // so unlike later stages the shipper may change here.
                const {
                    orderId: _orderId, seq: _seq, year: _year, createdBy: _createdBy,
                    carrierPaymentStatus: _cps, shipperPaymentStatus: _sps,
                    ...fields
                } = toInsertValues(
                    input.values,
                    { orderId: current.orderId, seq: current.seq, year: current.year },
                    ctx.session.user.id,
                );

                // A prospect normally has no proofs (recording one is
                // rejected), but a reverted order may: the proofs must still
                // win over the booked "pending" scaffold when it re-books
                const payments = await paymentSums(ctx.db, current.id);

                const [updated] = await ctx.db
                    .update(order)
                    .set({
                        ...fields,
                        // The booking patch on top of the same offer's money
                        // the transform already mapped: what it adds is the
                        // empty cab of a carrier change, since the driver and
                        // the rig prefilled from the previous booking belong
                        // to the carrier that named them, not to this one.
                        ...accepted?.patch,
                        // Booked payment scaffolding, dealDate, counters —
                        // derived columns win last, exactly like update
                        ...deriveOrderFields(current, {
                            status: input.values.status,
                            route: input.values.routeType,
                            fiscalRegime: acceptedInput?.fiscalRegime,
                            weight: input.values.weight,
                            shipperTotal: input.values.shipperTotal,
                            carrierTotal: acceptedInput?.total,
                        }),
                        ...proofPaymentPatch({
                            ...current,
                            status: input.values.status,
                            shipperTotal: fields.shipperTotal ?? null,
                            carrierTotal: fields.carrierTotal ?? null,
                        }, payments),
                        ...flagPatch,
                        version: sql`${order.version} + 1`,
                    })
                    .where(and(
                        eq(order.orderId, input.orderId),
                        eq(order.version, input.expectedVersion),
                    ))
                    .returning();

                if (!updated) {
                    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
                }

                // Same ordering as the transition door: the offers are
                // settled only once the order row itself has landed
                if (accepted) {
                    await accepted.settle();
                }

                const { status: _status, ...changed } = diffChangedFields(current, fields);

                if (Object.keys(changed).length > 0) {
                    await ctx.db.insert(orderHistory).values({
                        orderId: current.id,
                        actorUserId: ctx.session.user.id,
                        kind: "update",
                        changedFields: changed,
                    });
                }

                if (booking) {
                    await ctx.db.insert(orderHistory).values({
                        orderId: current.id,
                        actorUserId: ctx.session.user.id,
                        kind: "transition",
                        fromStatus: "prospect",
                        toStatus: "booked",
                        ...(accepted && { metadata: { offer: accepted.historyOffer } }),
                    });

                    // No skip row: a booking rarely names a driver now, and
                    // order.update opens the thread when the phone arrives
                    const followUp = startFollowUpChat(ctx.db, updated, current.id)
                        .catch((error: unknown) => console.error(`follow-up chat failed for ${input.orderId}`, error));

                    if (ctx.waitUntil) ctx.waitUntil(followUp); else await followUp;
                }

                const loadingBay = await lookupLoadingBay(ctx.db, updated);

                if (!await syncSheetsAndRecord(ctx.db, accessToken, updated)) {
                    return { orderId: input.orderId, order: updated, loadingBay, warning: "SHEET_FAILED" };
                }

                return { orderId: input.orderId, order: updated, loadingBay };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /** One status change; see transitionOrder for the rules it enforces. */
    transition: authorizedProcedure("order", ["transition"])
        .input(TransitionSchema)
        .mutation(async ({ ctx, input }): Promise<TransitionOrderOutput> => {
            try {
                return await transitionOrder(ctx, input);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /** Clears the review flag — supervisory action, appends its own history row. */
    resolveFlag: authorizedProcedure("order", ["flag-resolve"])
        .input(
            z.object({
                orderId: z.string(),
                expectedVersion: z.number().int().min(1),
                note: z.string().trim().min(5).max(2000).optional(),
            }),
        )
        .mutation(async ({ ctx, input }): Promise<TransitionOrderOutput> => {
            try {
                const [current] = await ctx.db
                    .select()
                    .from(order)
                    .where(eq(order.orderId, input.orderId));

                if (!current) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }
                if (!current.flaggedForReview) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_FLAGGED" });
                }

                const [updated] = await ctx.db
                    .update(order)
                    .set({
                        flaggedForReview: false,
                        flagReason: null,
                        flaggedAt: null,
                        flaggedBy: null,
                        version: sql`${order.version} + 1`,
                    })
                    .where(and(
                        eq(order.id, current.id),
                        eq(order.version, input.expectedVersion),
                    ))
                    .returning();

                if (!updated) {
                    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: current.id,
                    actorUserId: ctx.session.user.id,
                    kind: "flag",
                    metadata: {
                        resolved: true,
                        reason: current.flagReason,
                        ...(input.note && { note: input.note }),
                    },
                });

                return { orderId: input.orderId, order: updated };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Emails a generated transport-order PDF to a party, with manual CCs.
     * The client generates the PDF (pdf-lib in the browser), uploads it to
     * EdgeStore and passes the URL; the server fetches the bytes, sends
     * through Resend and records the send as an order document + history.
     */
    sendPdf: authorizedProcedure("document", ["create"])
        .input(
            z.object({
                orderId: z.string(),
                party: z.enum(["shipper", "carrier"]),
                url: z.url(),
                filename: z.string().trim().min(1).max(200),
                to: z.email(),
                cc: z.array(z.email()).max(5).default([]),
                message: z.string().trim().max(2000).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { protocol, hostname } = new URL(input.url);

                if (protocol !== "https:" || !hostname.endsWith(".edgestore.dev")) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
                }

                const [current] = await ctx.db
                    .select()
                    .from(order)
                    .where(eq(order.orderId, input.orderId));

                if (!current) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                const response = await fetch(input.url);

                if (!response.ok) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "DOCUMENT_FETCH_FAILED" });
                }

                const content = Buffer.from(await response.arrayBuffer()).toString("base64");

                const result = await sendEmail({
                    to: [input.to],
                    cc: input.cc,
                    subject: `Appload — ${input.orderId}`,
                    html: input.message
                        ? `<p>${input.message}</p>`
                        : `<p>Segue em anexo o documento da ordem ${input.orderId}.</p>`,
                    attachments: [{ filename: input.filename, content }],
                });

                if (!result.ok) {
                    throw new TRPCError({ code: "BAD_GATEWAY", message: "EMAIL_FAILED", cause: new Error(result.error) });
                }

                await ctx.db.batch([
                    ctx.db.insert(orderDocument).values({
                        orderId: current.id,
                        type: "transport-order",
                        party: input.party,
                        title: input.filename,
                        url: input.url,
                        mimeType: "application/pdf",
                        uploadedBy: ctx.session.user.id,
                    }),
                    ctx.db.insert(orderHistory).values({
                        orderId: current.id,
                        actorUserId: ctx.session.user.id,
                        kind: "document",
                        metadata: {
                            type: "transport-order",
                            party: input.party,
                            sentTo: input.to,
                            ...(input.cc.length > 0 && { cc: input.cc.join(", ") }),
                        },
                    }),
                ]);

                return { ok: true as const, simulated: result.simulated };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The details page in one round: the full row, its live documents, the
     * history timeline (with actor names snapshot-joined), the sheet sync
     * state for the badge and the carrier offers.
     */
    get: authorizedProcedure("order", ["read"])
        .input(z.object({ orderId: z.string() }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select()
                .from(order)
                .where(eq(order.orderId, input.orderId));

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const [documents, history, [sync], [dispute], offers] = await Promise.all([
                ctx.db
                    .select()
                    .from(orderDocument)
                    .where(and(eq(orderDocument.orderId, row.id), isNull(orderDocument.deletedAt)))
                    .orderBy(desc(orderDocument.createdAt)),
                ctx.db
                    .select({
                        id: orderHistory.id,
                        kind: orderHistory.kind,
                        fromStatus: orderHistory.fromStatus,
                        toStatus: orderHistory.toStatus,
                        changedFields: orderHistory.changedFields,
                        metadata: orderHistory.metadata,
                        createdAt: orderHistory.createdAt,
                        actorName: user.name,
                    })
                    .from(orderHistory)
                    .leftJoin(user, eq(orderHistory.actorUserId, user.id))
                    .where(eq(orderHistory.orderId, row.id))
                    .orderBy(desc(orderHistory.createdAt)),
                ctx.db
                    .select()
                    .from(sheetSync)
                    .where(eq(sheetSync.orderId, row.id)),
                // The active dispute, if any: the banner, the payment holds
                // and the closure block all read it from here
                ctx.db
                    .select({
                        id: orderDispute.id,
                        status: orderDispute.status,
                        reason: orderDispute.reason,
                        holdShipperPayments: orderDispute.holdShipperPayments,
                        holdCarrierPayments: orderDispute.holdCarrierPayments,
                        openedAt: orderDispute.openedAt,
                    })
                    .from(orderDispute)
                    .where(and(eq(orderDispute.orderId, row.id), inArray(orderDispute.status, [...ACTIVE_DISPUTE_STATUSES])))
                    .limit(1),
                // The same read the offers router serves, so the card the
                // page renders and the list its dialogs fetch never differ
                listOffers(ctx.db, row.id),
            ]);

            // Free: the timeline above already holds every row the rule reads,
            // so the header can name the resume step without a second query
            const resumeStatus = row.status === "stopped" || row.status === "issue"
                ? resumeFromHistory(history)
                : null;

            return { order: row, documents, history, sheetSync: sync ?? null, dispute: dispute ?? null, resumeStatus, offers };
        }),

    /**
     * Everything the transition UI needs, computed server-side so the
     * dialogs only ever offer legal targets: allowed moves with their
     * requirements, the current version for the optimistic-lock handshake,
     * and the derived resume target for interrupted orders.
     */
    transitionOptions: authorizedProcedure("order", ["read"])
        .input(z.object({ orderId: z.string() }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select({
                    id: order.id,
                    status: order.status,
                    route: order.route,
                    version: order.version,
                    flaggedForReview: order.flaggedForReview,
                    flagReason: order.flagReason,
                    // Both gates are decided on the stored row, so a move is
                    // never advertised as takeable when the mutation would
                    // refuse it: booking needs an offer still awaiting a
                    // decision, dispatch needs the driver and the truck
                    truckPlate: order.truckPlate,
                    truckAge: order.truckAge,
                    driverId: order.driverId,
                    driverName: order.driverName,
                    driverPhoneNumber: order.driverPhoneNumber,
                    driverPassport: order.driverPassport,
                    pendingOffers: pendingOfferCount,
                    // The offer picker prices the commission against the
                    // shipper's leg while the operator is still choosing
                    shipperTotal: order.shipperTotal,
                    shipperVAT: order.shipperVAT,
                    shipperCurrency: order.shipperCurrency,
                    disputeStatus: order.disputeStatus,
                })
                .from(order)
                .where(eq(order.orderId, input.orderId));

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const resumeStatus =
                row.status === "stopped" || row.status === "issue"
                    ? await deriveResumeStatus(ctx.db, row.id)
                    : null;

            const context = { status: row.status, route: row.route, role: ctx.staff.role, resumeStatus };

            // Advertised but not takeable: nothing to accept, no rig to
            // dispatch, or a dispute that must be settled before the cargo
            // closes. Always a boolean — a conditional spread would infer a
            // union and break `entry.blocked` in the dialog.
            const dispatchBlocked = !isReadyToDispatch(row);
            const disputeBlocked = isActiveDispute(row.disputeStatus);

            const targets = allowedTransitions(context).map((to) => {
                const requirements = transitionRequirements(row.status, to, { resumeStatus }) ?? [];

                // Keyed on the requirement, not on the target: an admin
                // reversal back to booked does not accept an offer, and
                // must not be blocked for lacking one
                const blockedReason: "NO_OFFERS" | "INCOMPLETE_FOR_DISPATCH" | "DISPUTE_OPEN" | null =
                    requirements.includes("offer") && row.pendingOffers === 0 ? "NO_OFFERS"
                        : to === "to-loading" && dispatchBlocked ? "INCOMPLETE_FOR_DISPATCH"
                            : to === "completed" && disputeBlocked ? "DISPUTE_OPEN"
                                : null;

                return {
                    to,
                    requirements,
                    blocked: blockedReason !== null,
                    blockedReason,
                };
            });

            return {
                status: row.status,
                version: row.version,
                flaggedForReview: row.flaggedForReview,
                flagReason: row.flagReason,
                resumeStatus,
                canResolveFlag: isAuthorized(ctx.staff.role, "order", ["flag-resolve"]),
                targets,
                pendingOffers: row.pendingOffers,
                shipper: {
                    total: row.shipperTotal === null ? null : Number(row.shipperTotal),
                    vat: row.shipperVAT === null ? null : Number(row.shipperVAT),
                    currency: row.shipperCurrency ?? "MZN",
                },
            };
        }),
});
