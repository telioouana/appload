import { z } from "zod";
import { and, desc, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDispute, orderDocument, orderHistory, orderOffer, sheetSync, type Order } from "@workspace/db/orders";
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

import { OrderError } from "@workspace/domain/orders/errors";
import { guardOrderGate } from "@workspace/domain/kyc/order-gate";
import { FOLLOW_UP_STATUSES } from "@workspace/domain/tracking/conversations";
import { foreignKeyViolationConstraint } from "@workspace/db/errors";
import { deriveOrderFields } from "@workspace/domain/orders/derive";
import { allowedTransitions, transitionRequirements } from "@workspace/domain/orders/transitions";
import { isReadyToDispatch } from "@workspace/domain/orders/dispatch-readiness";
import { carrierSnapshot } from "@workspace/domain/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@workspace/domain/orders/commission";
import { getSheetsAccessToken } from "@/lib/orders/google-token";
import { currentOrderYear, maxSheetSeq, nextOrderId } from "@workspace/domain/orders/order-id";
import { getRange } from "@/lib/orders/sheets-client";
import { HEADER_ROW, SHEET_NAME, resolveColumns } from "@/lib/orders/orders-sheet-mapping";
import { syncSheetsAndRecord } from "@/lib/orders/sheet-outbox";
import { changedPaymentParties, proofPaymentPatch, type PaymentSums } from "@workspace/domain/orders/payments";
import { paymentSums } from "@workspace/domain/orders/payment-sums";
import { diffChangedFields } from "@workspace/domain/orders/order-facts";
import { acceptedOfferOf, createOrder, decimal, toInsertValues, type CreateOrderOutput } from "@workspace/domain/orders/create";
import {
    acceptOffer,
    applyTransition,
    assertCurrencyUnlocked,
    deriveResumeStatus,
    pendingOfferCount,
    resumeFromHistory,
    startFollowUpChat,
    type TransitionOrderOutput,
} from "@workspace/domain/orders/transition";

import { listOffers } from "./offers-procedures";

// The order write itself lives in @workspace/domain/orders (both apps go
// through the same door); these are re-exported so the routers, the
// activity catalog and the orders list keep importing them from here.
export { pendingOfferCount } from "@workspace/domain/orders/transition";
export type { CreateOrderOutput } from "@workspace/domain/orders/create";
export type { BookedOfferMetadata, TransitionOrderOutput } from "@workspace/domain/orders/transition";

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

export type UpdateOrderOutput = {
    orderId: string;
    order: Order;
    loadingBay: LoadingBay["type"] | null;
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
 * Admin's side of the shared door: the staff actor it acts as, and the
 * Sheets push the package calls back into once the row has landed.
 *
 * `options.accessToken` lets a batch mint the Sheets token once; `null`
 * means the caller already failed to get one.
 */
export async function transitionOrder(
    ctx: TransitionContext,
    input: TransitionInput,
    options: { accessToken?: string | null } = {},
): Promise<TransitionOrderOutput> {
    return applyTransition(
        {
            db: ctx.db,
            actor: { kind: "staff", userId: ctx.session.user.id, role: ctx.staff.role },
            waitUntil: ctx.waitUntil,
            sheets: {
                push: async (row) => {
                    const accessToken = options.accessToken === undefined
                        ? await getSheetsAccessToken(ctx.authApi, ctx.headers, ctx.session.user.id)
                        : options.accessToken;

                    return { ok: accessToken !== null && await syncSheetsAndRecord(ctx.db, accessToken, row) };
                },
            },
        },
        input,
    );
}

export const orderRouter = createTRPCRouter({
    create: authorizedProcedure("order", ["create"])
        .input(CreateOrderSchemaServer)
        .mutation(async ({ ctx, input }): Promise<CreateOrderOutput> => {
            try {
                const userId = ctx.session.user.id;
                const year = currentOrderYear();

                const dbMaxSeq = async () => {
                    const [row] = await ctx.db
                        .select({ value: max(order.seq) })
                        .from(order)
                        .where(eq(order.year, year));

                    return row?.value ?? 0;
                };

                // The Sheets side of the id, resolved once and before the row
                // is written: the header check refuses a sheet whose columns
                // were changed, and the sheet's own max sequence covers rows
                // added there by hand. The same token then rides into the push.
                let sheet: { accessToken: string; sheetSeq: number } | null = null;

                const resolveSheet = async () => {
                    if (sheet === null) {
                        const accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, userId);

                        // Refuse to write into a sheet whose columns were changed
                        const [headerRow] = await getRange(accessToken, SHEET_NAME, `${HEADER_ROW}:${HEADER_ROW}`);
                        resolveColumns(headerRow ?? []);

                        sheet = { accessToken, sheetSeq: maxSheetSeq(await getRange(accessToken, SHEET_NAME, "A:A"), year) };
                    }

                    return sheet;
                };

                return await createOrder(
                    {
                        db: ctx.db,
                        actor: { kind: "staff", userId, role: ctx.staff.role },
                        waitUntil: ctx.waitUntil,
                        sheets: {
                            push: async (row) => {
                                const { accessToken } = await resolveSheet();

                                return { ok: await syncSheetsAndRecord(ctx.db, accessToken, row) };
                            },
                        },
                    },
                    input,
                    // The unique (year, seq) index arbitrates concurrent creates:
                    // every attempt recomputes the sequence from the database
                    {
                        nextOrderId: async () => {
                            const { sheetSeq } = await resolveSheet();

                            return nextOrderId(await dbMaxSeq(), sheetSeq, year);
                        },
                    },
                );
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
                        { kind: "staff", userId: ctx.session.user.id, role: ctx.staff.role },
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
