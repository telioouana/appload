import { z } from "zod";
import { and, desc, eq, isNull, max, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDocument, orderHistory, sheetSync, type CreateOrder, type Order } from "@workspace/db/orders";
import { user } from "@workspace/db/users";
import { trailer, truck } from "@workspace/db/fleet";
import type { db as Database } from "@workspace/db/db";
import { ORDER_STATUS, type LoadingBay } from "@workspace/db/types";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import { isAuthorized } from "@workspace/auth/user-permissions";
import { sendEmail } from "@workspace/auth/email";

import { CreateOrderSchemaServer, UpdateOrderSchemaServer, type CreateOrderForm } from "@/backend/schemas/order";

import { OrderError } from "@/lib/orders/errors";
import { guardOrderGate } from "@/lib/kyc/order-gate";
import { startConversation } from "@/lib/chats/conversations";
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from "@/lib/db-errors";
import { deriveOrderFields, derivePaymentStatus } from "@/lib/orders/derive";
import { allowedTransitions, transitionRequirements, validateTransition, type OrderStatus } from "@/lib/orders/transitions";
import { isReadyToBook } from "@/lib/orders/booking-readiness";
import { getSheetsAccessToken } from "@/lib/orders/google-token";
import { currentOrderYear, maxSheetSeq, nextOrderId } from "@/lib/orders/order-id";
import { getRange } from "@/lib/orders/sheets-client";
import { HEADER_ROW, SHEET_NAME, resolveColumns } from "@/lib/orders/orders-sheet-mapping";
import { syncSheetsAndRecord } from "@/lib/orders/sheet-outbox";
import { changedCurrencyParties, partiesWithMoneyDocuments } from "@/lib/orders/note-currency";
import { changedPaymentParties, proofPaymentPatch, type PaymentSums } from "@/lib/orders/payments";
import { paymentSums } from "@/lib/orders/payment-sums";
import { diffChangedFields } from "@/lib/orders/order-facts";

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

function toInsertValues(
    input: CreateOrderForm,
    id: { orderId: string; seq: number; year: number },
    userId: string,
): CreateOrder {
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

        carrierName: input.carrierName,
        carrierId: input.carrierId ?? null,

        driverName: input.driverName ?? null,
        driverId: input.driverId ?? null,
        driverPhoneNumber: input.driverContact ?? null,
        driverPassport: input.driverPassport ?? null,

        truckPlate: input.truckPlate,
        truckAge: input.truckAge,
        linkPlate: input.linkPlate || null,
        trailerPlate: input.trailerPlate || null,

        fiscalRegime: input.fiscalRegime ?? null,
        carrierSubtotal: decimal(input.carrierSubtotal),
        carrierVAT: decimal(input.carrierVAT),
        carrierTotal: decimal(input.carrierTotal),
        carrierCurrency: input.carrierCurrency,

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
 * Booked side effect: open (or relink) the driver's follow-up conversation.
 * Skips silently when the order has no driver phone yet — the skip lands in
 * the history metadata so it is visible on the timeline.
 */
async function startFollowUpChat(db: typeof Database, updated: Order, orderPk: string): Promise<void> {
    if (!updated.driverPhoneNumber) {
        await db.insert(orderHistory).values({
            orderId: orderPk,
            actorUserId: null,
            kind: "system",
            metadata: { followUpChat: "skipped-no-phone" },
        });
        return;
    }

    const { conversation, existing } = await startConversation(db, {
        driverName: updated.driverName ?? updated.driverPhoneNumber,
        driverPhone: updated.driverPhoneNumber,
        orderId: updated.orderId,
    });

    await db.insert(orderHistory).values({
        orderId: orderPk,
        actorUserId: null,
        kind: "system",
        metadata: { followUpChat: existing ? "relinked" : "created", conversationId: conversation.id },
    });
}

/**
 * The chain status an interrupted (stopped/issue) order returns to: the
 * last transition target outside the interrupt pair. Derived from history
 * instead of a denormalized column so it can never drift.
 */
async function deriveResumeStatus(db: typeof Database, orderPk: string): Promise<OrderStatus | null> {
    const [row] = await db
        .select({ toStatus: orderHistory.toStatus })
        .from(orderHistory)
        .where(and(
            eq(orderHistory.orderId, orderPk),
            eq(orderHistory.kind, "transition"),
            notInArray(orderHistory.toStatus, ["stopped", "issue"]),
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

export type CreateOrderOutput = {
    orderId: string;
    status: Order["status"];
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

export const orderRouter = createTRPCRouter({
    create: authorizedProcedure("order", ["create"])
        .input(CreateOrderSchemaServer)
        .mutation(async ({ ctx, input }): Promise<CreateOrderOutput> => {
            try {
                const userId = ctx.session.user.id;

                // Verification only bites once a carrier is actually
                // committed: a prospect is still a quote, and quoting an
                // unverified carrier is how the backlog gets discovered
                const { flagPatch } = input.status === "booked" && input.carrierId
                    ? await guardOrderGate(
                        ctx.db,
                        {
                            carrierId: input.carrierId,
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

                // Birth certificate: fromStatus null marks creation
                await ctx.db.insert(orderHistory).values({
                    orderId: saved.id,
                    actorUserId: userId,
                    kind: "transition",
                    fromStatus: null,
                    toStatus: saved.status,
                });

                // The order is stored either way; failures land in the
                // sheet_sync outbox and the retry cron heals them
                if (!await syncSheetsAndRecord(ctx.db, accessToken, saved)) {
                    return { orderId: saved.orderId, status: saved.status, warning: "SHEET_FAILED" };
                }

                return { orderId: saved.orderId, status: saved.status };
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
                        ...(data.carrierName !== undefined && { carrierName: data.carrierName }),
                        ...(data.carrierId !== undefined && { carrierId: data.carrierId || null }),
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
     * schema (and booked-completeness refines) creation runs, so confirming
     * a prospect can never dodge the validation creation applies. When the
     * payload books it, the transition (history row, payment scaffolding,
     * follow-up chat) rides in the same write.
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

                await assertCurrencyUnlocked(ctx.db, input.values, current);

                const booking = input.values.status === "booked";

                if (booking && !isAuthorized(ctx.staff.role, "order", ["transition"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }

                // Same gate as create, at the moment the deal is committed
                const { flagPatch } = booking && input.values.carrierId
                    ? await guardOrderGate(
                        ctx.db,
                        {
                            carrierId: input.values.carrierId,
                            driverId: input.values.driverId,
                            truckPlate: input.values.truckPlate,
                            trailerPlate: input.values.trailerPlate,
                            linkPlate: input.values.linkPlate,
                        },
                        { role: ctx.staff.role, actorId: ctx.session.user.id },
                    )
                    : { flagPatch: null };

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
                        // Booked payment scaffolding, dealDate, counters —
                        // derived columns win last, exactly like update
                        ...deriveOrderFields(current, {
                            status: input.values.status,
                            route: input.values.routeType,
                            fiscalRegime: input.values.fiscalRegime,
                            weight: input.values.weight,
                            shipperTotal: input.values.shipperTotal,
                            carrierTotal: input.values.carrierTotal,
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
                    });

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

    /**
     * The one door for status changes. Validates the move against the
     * declarative state machine (current status + route + actor role),
     * enforces the payload the move demands (note / evidence / POD),
     * stamps implied milestone dates, applies the derived side effects
     * (booked payment scaffolding, dealDate, podStatus...), raises the
     * review flag on risky moves, and appends the history row.
     */
    transition: authorizedProcedure("order", ["transition"])
        .input(
            z.object({
                orderId: z.string(),
                to: z.enum(ORDER_STATUS),
                expectedVersion: z.number().int().min(1),
                note: z.string().trim().min(5).max(2000).optional(),
                // Evidence/POD upload backing the move (EdgeStore URL). The
                // document row itself is created by the documents router;
                // here it also lands in the history metadata.
                document: z.object({
                    url: z.url(),
                    name: z.string().max(200).optional(),
                    size: z.number().int().optional(),
                    mimeType: z.string().max(100).optional(),
                }).optional(),
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

                // Closing an order as lost (cancelled or underbid) is its own
                // permission on top of transition
                if ((input.to === "cancelled" || input.to === "underbid") && !isAuthorized(ctx.staff.role, "order", ["cancel"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }

                // Booking a prospect demands the full carrier/driver/fleet/
                // amount block. Same stored-row bar the deal form reaches
                // through its refines, minus the fleet-derived loading bay no
                // column carries — incomplete prospects go through that form
                // (order.updateDeal, "Confirm order"), never this door.
                if (input.to === "booked" && current.status === "prospect" && !isReadyToBook(current)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "INCOMPLETE_FOR_BOOKING" });
                }

                // Verification is checked once, at the moment the cargo is
                // committed to this carrier and rig. Later transitions move
                // an order that was already gated.
                const { flagPatch: gateFlag } = input.to === "booked" && current.carrierId
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

                const [updated] = await ctx.db
                    .update(order)
                    .set({
                        ...stamps,
                        status: input.to,
                        ...(input.to === "delivered" && current.podStatus === null && {
                            podStatus: "pending-collection" as const,
                        }),
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
                        ...deriveOrderFields(current, { status: input.to, ...stamps }),
                        // ...except on POP-governed legs, where the recorded
                        // proofs beat the booked "pending" scaffold and the
                        // prospect/cancelled rules apply to the NEW status
                        ...proofPaymentPatch({ ...current, status: input.to }, payments),
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
                    kind: "transition",
                    fromStatus: current.status,
                    toStatus: input.to,
                    metadata: {
                        ...(input.note && { note: input.note }),
                        ...(flag && { flagged: true }),
                        ...(input.document && { document: input.document }),
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

                // Booked orders get a follow-up chat with the driver. Post-
                // response and best-effort: a chat/Infobip failure must never
                // fail the booking.
                if (input.to === "booked") {
                    const followUp = startFollowUpChat(ctx.db, updated, current.id)
                        .catch((error: unknown) => console.error(`follow-up chat failed for ${input.orderId}`, error));

                    if (ctx.waitUntil) ctx.waitUntil(followUp); else await followUp;
                }

                try {
                    const accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, ctx.session.user.id);

                    if (!await syncSheetsAndRecord(ctx.db, accessToken, updated)) {
                        return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
                    }
                } catch (error) {
                    // Token acquisition failed — the outbox cron retries with
                    // the service account
                    console.error(`sheet sync failed on transition for ${input.orderId}`, error);
                    return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
                }

                return { orderId: input.orderId, order: updated };
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
     * history timeline (with actor names snapshot-joined) and the sheet
     * sync state for the badge.
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

            const [documents, history, [sync]] = await Promise.all([
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
            ]);

            return { order: row, documents, history, sheetSync: sync ?? null };
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
                    // Booking readiness is decided on the stored row, so a
                    // prospect is never advertised as bookable when the
                    // mutation would refuse it
                    carrierId: order.carrierId,
                    carrierName: order.carrierName,
                    fiscalRegime: order.fiscalRegime,
                    truckPlate: order.truckPlate,
                    truckAge: order.truckAge,
                    driverId: order.driverId,
                    driverName: order.driverName,
                    driverPhoneNumber: order.driverPhoneNumber,
                    driverPassport: order.driverPassport,
                    carrierSubtotal: order.carrierSubtotal,
                    carrierTotal: order.carrierTotal,
                    carrierCurrency: order.carrierCurrency,
                    shipperCurrency: order.shipperCurrency,
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

            // Advertised but not takeable: the deal form is the way to the
            // rest of the data. Always a boolean — a conditional spread would
            // infer a union and break `entry.blocked` in the dialog.
            const bookingBlocked = row.status === "prospect" && !isReadyToBook(row);

            const targets = allowedTransitions(context).map((to) => ({
                to,
                requirements: transitionRequirements(row.status, to, { resumeStatus }) ?? [],
                blocked: to === "booked" && bookingBlocked,
            }));

            return {
                status: row.status,
                version: row.version,
                flaggedForReview: row.flaggedForReview,
                flagReason: row.flagReason,
                resumeStatus,
                canResolveFlag: isAuthorized(ctx.staff.role, "order", ["flag-resolve"]),
                targets,
            };
        }),
});
