import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
    DOCUMENT_PARTY,
    NOTE_REASON,
    ORDER_DOCUMENT_TYPE,
    orderDocument,
    orderHistory,
    order,
    type DocumentParty,
    type Order,
    type OrderDocument,
    type OrderHistoryKind,
} from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";
import type { Auth } from "@workspace/auth/server";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import { isAuthorized } from "@workspace/auth/user-permissions";

import { effectiveTotals } from "@/lib/orders/totals";
import { getSheetsAccessToken } from "@/lib/orders/google-token";
import { markRecomputePending, syncSheetsAndRecord } from "@/lib/orders/sheet-outbox";
import { isNote } from "@/lib/orders/note-currency";
import { DEMURRAGE, demurrageFieldsComplete, descriptionRequired, noteDetailsSchema, noteOrderPatch } from "@/lib/orders/note-reasons";
import { applyDocumentSums } from "@/lib/orders/document-sums";
import { applyOrderFields, type OrderFieldPatch } from "@/lib/orders/order-facts";
import { paymentSums } from "@/lib/orders/payment-sums";
import { PAYMENT_KEYS, isFuturePaymentDate, isProofOfPayment } from "@/lib/orders/payments";

import { toTRPCError } from "./procedures";

// Uploads must come from our EdgeStore bucket — never accept arbitrary
// URLs into financial records
function assertEdgeStoreUrl(url: string) {
    const { protocol, hostname } = new URL(url);

    if (protocol !== "https:" || !hostname.endsWith(".edgestore.dev")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

async function loadOrder(db: typeof Database, orderId: string): Promise<Order> {
    const [row] = await db.select().from(order).where(eq(order.orderId, orderId));

    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    return row;
}

/**
 * The hand-typed paid block of one leg, captured on the first proof of
 * payment so the value it replaces is never lost from the audit trail.
 * Null when the leg had nothing typed.
 */
function manualPaymentSnapshot(row: Order, party: DocumentParty) {
    const keys = PAYMENT_KEYS[party];
    const snapshot = {
        paidAmount: row[keys.amount],
        paymentStatus: row[keys.status],
        fullPaymentDate: row[keys.fullPaymentDate]?.toISOString() ?? null,
    };

    const typed = (snapshot.paidAmount !== null && Number(snapshot.paidAmount) !== 0)
        || (snapshot.paymentStatus !== null && snapshot.paymentStatus !== "pending" && snapshot.paymentStatus !== "not-applicable")
        || snapshot.fullPaymentDate !== null;

    return typed ? snapshot : null;
}

/** The party an invoice document belongs to, implied by its type */
function invoicePartyOf(type: string): DocumentParty | null {
    return type === "shipper-invoice" ? "shipper" : type === "carrier-invoice" ? "carrier" : null;
}

/** The invoice number/date an invoice upload carries, as an order patch (empty number clears it) */
function invoiceFields(
    party: DocumentParty,
    details: { invoiceNumber?: string; invoiceDate?: Date },
): OrderFieldPatch {
    return {
        ...(details.invoiceNumber !== undefined && { [`${party}InvoiceNumber`]: details.invoiceNumber || null }),
        ...(details.invoiceDate !== undefined && { [`${party}InvoiceDate`]: details.invoiceDate }),
    };
}

/** History row kind and the facts every document row contributes to its entry */
const historyKind = (type: string): OrderHistoryKind =>
    isProofOfPayment(type) ? "payment" : isNote(type) ? "note" : "document";
const historyFacts = (document: OrderDocument) => ({
    documentId: document.id,
    type: document.type,
    ...(document.party && { party: document.party }),
    ...(document.total && { total: document.total }),
    ...(document.currency && { currency: document.currency }),
    ...(document.paidAt && { paidAt: document.paidAt.toISOString() }),
});

/**
 * Everything that follows a committed document row. Money documents
 * (notes, proofs) rebuild the order's derived block and carry their facts
 * in that same locked write; an invoice upload only writes its facts. If
 * any of it fails the document still exists, so this never surfaces an
 * error the operator would answer by saving again — that would duplicate
 * the note or proof. Instead the order is flagged RECOMPUTE_CONFLICT in the
 * sheet outbox (the next push or the sheet-sync cron re-derives the money
 * block) and the result says the order update is pending; the operator is
 * told to re-check any facts (invoice number/date, demurrage) by hand.
 */
async function settleDocument(
    db: typeof Database,
    orderPk: string,
    actorUserId: string,
    input: { money: boolean; facts: OrderFieldPatch | null },
): Promise<{ order: Order | null; pending: boolean }> {
    const facts = input.facts && Object.keys(input.facts).length > 0 ? input.facts : null;

    try {
        const updated = input.money
            ? await applyDocumentSums(db, orderPk, facts ? { fields: facts, actorUserId } : undefined)
            : facts
                ? await applyOrderFields(db, orderPk, facts, actorUserId)
                : null;

        return { order: updated, pending: false };
    } catch (error) {
        console.error(`order update after document write failed for ${orderPk}`, error);
        await markRecomputePending(db, orderPk).catch(() => undefined);
        return { order: null, pending: true };
    }
}

/**
 * Pushes the updated order to the spreadsheet; the mutation already
 * committed, so a failure only downgrades to a warning.
 */
async function pushToSheets(
    ctx: { db: typeof Database; authApi: Auth["api"]; headers: Headers },
    userId: string,
    updated: Order,
    label: string,
): Promise<boolean> {
    try {
        const accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, userId);
        return await syncSheetsAndRecord(ctx.db, accessToken, updated);
    } catch (error) {
        console.error(`sheet sync failed on ${label} for ${updated.orderId}`, error);
        return false;
    }
}

export type DocumentMutationOutput = {
    document: OrderDocument;
    order: Order | null;
    /**
     * SHEET_FAILED: the order is updated but the spreadsheet push failed
     * (retried by the cron). RECOMPUTE_PENDING: the document is saved but
     * the order row could not be updated right now — its money block will
     * be re-derived automatically; facts the document carried (invoice
     * number/date, demurrage stage/days, damage share) must be checked by
     * hand.
     */
    warning?: "SHEET_FAILED" | "RECOMPUTE_PENDING";
};

/** Dates typed by hand: nothing before this is a real business date, and JS extremes overflow Postgres */
const EARLIEST_BUSINESS_DATE = new Date("2000-01-01T00:00:00Z");

export const documentsRouter = createTRPCRouter({
    list: authorizedProcedure("document", ["list"])
        .input(z.object({
            orderId: z.string(),
            includeDeleted: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            const row = await loadOrder(ctx.db, input.orderId);

            // Voided documents stay visible to supervisors only
            const showDeleted = input.includeDeleted && isAuthorized(ctx.staff.role, "document", ["delete"]);

            return ctx.db
                .select()
                .from(orderDocument)
                .where(and(
                    eq(orderDocument.orderId, row.id),
                    ...(showDeleted ? [] : [isNull(orderDocument.deletedAt)]),
                ))
                .orderBy(desc(orderDocument.createdAt));
        }),

    /**
     * Per-party proof-of-payment state: whether the leg is POP-governed,
     * what the live proofs sum to, and the figures the UI needs for its
     * confirmations (effective total, the manual paid block a first proof
     * would replace). Drives the edit-sheet lock and the details page.
     */
    paymentSummary: authorizedProcedure("document", ["list"])
        .input(z.object({ orderId: z.string() }))
        .query(async ({ ctx, input }) => {
            const row = await loadOrder(ctx.db, input.orderId);
            const sums = await paymentSums(ctx.db, row.id);
            const effective = effectiveTotals(row);

            const party = (side: DocumentParty) => {
                const keys = PAYMENT_KEYS[side];

                return {
                    ...sums[side],
                    effectiveTotal: side === "shipper" ? effective.shipperTotal : effective.carrierTotal,
                    currency: side === "shipper" ? row.shipperCurrency : row.carrierCurrency,
                    manualPaidAmount: Number(row[keys.amount] ?? 0),
                    paymentStatus: row[keys.status],
                    fullPaymentDate: row[keys.fullPaymentDate],
                };
            };

            return {
                orderId: row.orderId,
                status: row.status,
                version: row.version,
                shipper: party("shipper"),
                carrier: party("carrier"),
            };
        }),

    create: authorizedProcedure("document", ["create"])
        .input(
            z.object({
                orderId: z.string(),
                type: z.enum(ORDER_DOCUMENT_TYPE),
                party: z.enum(DOCUMENT_PARTY).optional(),
                title: z.string().trim().max(200).optional(),
                url: z.url(),
                size: z.number().int().positive().optional(),
                mimeType: z.string().max(100).optional(),
                // Money block — required for debit/credit notes and proofs
                // of payment (where `total` is the amount paid). Whole cents:
                // the columns are numeric(14,2), so anything smaller would be
                // stored as 0.00
                subtotal: z.number().min(0).optional(),
                vat: z.number().min(0).optional(),
                total: z.number().min(0.01).optional(),
                currency: z.enum(["MZN", "ZAR", "USD"]).optional(),
                // Notes: description; proofs: reference; invoices: number
                reason: z.string().trim().max(1000).optional(),
                // Notes: the structured cause and its particulars
                reasonCode: z.enum(NOTE_REASON).optional(),
                details: noteDetailsSchema.optional(),
                // Proof of payment: bank value date
                paidAt: z.date().min(EARLIEST_BUSINESS_DATE).optional(),
                // Shipper/carrier invoice: recorded straight onto the order's
                // invoice columns (optional — a bare upload is still fine)
                invoiceNumber: z.string().trim().max(100).optional(),
                invoiceDate: z.date().min(EARLIEST_BUSINESS_DATE).optional(),
            }),
        )
        .mutation(async ({ ctx, input }): Promise<DocumentMutationOutput> => {
            try {
                assertEdgeStoreUrl(input.url);

                const note = isNote(input.type);
                const pop = isProofOfPayment(input.type);
                const invoiceParty = invoicePartyOf(input.type);
                const invoiceDetails = invoiceParty !== null
                    && (input.invoiceNumber !== undefined || input.invoiceDate !== undefined);
                // Facts a note writes onto the order (demurrage stage/days,
                // damage share); empty for every other reason
                const noteFacts = note && input.reasonCode ? noteOrderPatch(input.reasonCode, input.details) : {};

                // Writing invoice number/date or a note's demurrage/damage
                // facts is an order edit, gated as such even though it
                // arrives through the documents door
                const editsOrder = invoiceDetails || Object.keys(noteFacts).length > 0;
                if (editsOrder && !isAuthorized(ctx.staff.role, "order", ["update"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }

                if (note) {
                    if (!isAuthorized(ctx.staff.role, "note", ["create"])) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                    }
                    if (!input.party || input.total === undefined || !input.currency) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_FIELDS_REQUIRED" });
                    }
                    // The cause is structured; the free description is what
                    // explains an "other" note, every named reason stands alone
                    if (!input.reasonCode) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_REASON_REQUIRED" });
                    }
                    if (descriptionRequired(input.reasonCode) && !input.reason) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_DESCRIPTION_REQUIRED" });
                    }
                    // Demurrage sets the order's charged stage/days, so both
                    // must be named
                    if (input.reasonCode === DEMURRAGE && !demurrageFieldsComplete(input.details)) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_DEMURRAGE_FIELDS_REQUIRED" });
                    }
                }

                if (pop) {
                    if (!isAuthorized(ctx.staff.role, "payment", ["record"])) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                    }
                    if (!input.party || input.total === undefined || !input.paidAt || !input.currency) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "POP_FIELDS_REQUIRED" });
                    }
                    if (isFuturePaymentDate(input.paidAt)) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "POP_PAID_AT_FUTURE" });
                    }
                }

                const row = await loadOrder(ctx.db, input.orderId);

                if (note || pop) {
                    // Note and proof totals are summed per party with no
                    // currency dimension, and those sums drive the remaining
                    // amount, the commission and the accounting sheet. A
                    // document denominated differently from its party's leg
                    // would be added as though it were the same unit, so it
                    // is rejected here rather than silently mixed. A leg with
                    // no currency yet cannot take either: the first money
                    // document locks the leg's currency, and locking a null
                    // one would freeze it forever.
                    const partyCurrency = input.party === "carrier"
                        ? row.carrierCurrency
                        : row.shipperCurrency;

                    // A payment cannot be recorded against a quote: the
                    // leg's payment status is not-applicable until booked
                    if (pop && row.status === "prospect") {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "POP_ORDER_NOT_BOOKED" });
                    }
                    if (!partyCurrency) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: pop ? "POP_LEG_CURRENCY_MISSING" : "NOTE_LEG_CURRENCY_MISSING" });
                    }
                    if (input.currency !== partyCurrency) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: pop ? "POP_CURRENCY_MISMATCH" : "NOTE_CURRENCY_MISMATCH" });
                    }
                }

                // The first proof on a leg switches it to POP governance for
                // good; whatever was typed by hand is preserved in history
                const popParty = pop && input.party ? input.party : null;
                const replacedManual = popParty
                    ? await paymentSums(ctx.db, row.id).then((sums) =>
                        sums[popParty].governed ? null : manualPaymentSnapshot(row, popParty))
                    : null;

                // Only notes and proofs carry a money block; an invoice's
                // party is implied by its type; every other type is a plain
                // file. Whatever else the request sends is dropped so the
                // row cannot misreport its leg or its money.
                const money = note || pop;

                const [document] = await ctx.db
                    .insert(orderDocument)
                    .values({
                        orderId: row.id,
                        type: input.type,
                        party: invoiceParty ?? (money ? input.party ?? null : null),
                        title: input.title ?? null,
                        url: input.url,
                        size: input.size ?? null,
                        mimeType: input.mimeType ?? null,
                        subtotal: money && input.subtotal !== undefined ? String(input.subtotal) : null,
                        vat: money && input.vat !== undefined ? String(input.vat) : null,
                        total: money && input.total !== undefined ? String(input.total) : null,
                        currency: money ? input.currency ?? null : null,
                        // The invoice number doubles as the row's reference so
                        // the library shows it next to the file
                        reason: input.reason ?? (invoiceParty ? input.invoiceNumber || null : null),
                        reasonCode: note ? input.reasonCode ?? null : null,
                        details: note && input.details && Object.keys(input.details).length > 0 ? input.details : null,
                        paidAt: pop ? input.paidAt ?? null : null,
                        uploadedBy: ctx.session.user.id,
                    })
                    .returning();

                if (!document) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: row.id,
                    actorUserId: ctx.session.user.id,
                    kind: historyKind(document.type),
                    metadata: {
                        ...historyFacts(document),
                        ...(document.reason && { reason: document.reason }),
                        ...(document.reasonCode && { reasonCode: document.reasonCode }),
                        ...(document.details && { details: document.details }),
                        ...(replacedManual && { replacedManual }),
                    },
                });

                // From here on the document exists. Notes and proofs shift
                // money (rebuild the sums, re-derive the paid/remaining
                // block) and carry their facts in the same write; invoices
                // only carry facts (M/N and AD/AE on the accounting sheet).
                // Both end with a sheet push; anything else is a plain upload.
                const settled = await settleDocument(ctx.db, row.id, ctx.session.user.id, {
                    money,
                    facts: money
                        ? noteFacts
                        : invoiceParty && invoiceDetails
                            ? invoiceFields(invoiceParty, { invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate })
                            : null,
                });

                if (settled.pending) {
                    return { document, order: null, warning: "RECOMPUTE_PENDING" };
                }
                if (!settled.order) {
                    return { document, order: null };
                }
                if (!await pushToSheets(ctx, ctx.session.user.id, settled.order, document.type)) {
                    return { document, order: settled.order, warning: "SHEET_FAILED" };
                }

                return { document, order: settled.order };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Soft delete: the row keeps its audit trail and the blob stays in
     * storage; voided notes drop out of the sums and voided proofs out of
     * the paid amounts. Supervisory action.
     */
    softDelete: authorizedProcedure("document", ["delete"])
        .input(z.object({ documentId: z.string() }))
        .mutation(async ({ ctx, input }): Promise<DocumentMutationOutput> => {
            try {
                const [document] = await ctx.db
                    .select()
                    .from(orderDocument)
                    .where(eq(orderDocument.id, input.documentId));

                if (!document || document.deletedAt !== null) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                }

                const note = isNote(document.type);
                const pop = isProofOfPayment(document.type);

                if (note && !isAuthorized(ctx.staff.role, "note", ["void"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }
                if (pop && !isAuthorized(ctx.staff.role, "payment", ["void"])) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
                }

                const [deleted] = await ctx.db
                    .update(orderDocument)
                    .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
                    .where(and(eq(orderDocument.id, input.documentId), isNull(orderDocument.deletedAt)))
                    .returning();

                if (!deleted) {
                    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
                }

                await ctx.db.insert(orderHistory).values({
                    orderId: document.orderId,
                    actorUserId: ctx.session.user.id,
                    kind: historyKind(document.type),
                    metadata: { ...historyFacts(document), voided: true },
                });

                if (!note && !pop) {
                    return { document: deleted, order: null };
                }

                // The void is committed: a re-derivation that cannot land is
                // flagged for the cron, never reported as "try again"
                const settled = await settleDocument(ctx.db, document.orderId, ctx.session.user.id, { money: true, facts: null });

                if (settled.pending || !settled.order) {
                    return { document: deleted, order: null, warning: "RECOMPUTE_PENDING" };
                }
                if (!await pushToSheets(ctx, ctx.session.user.id, settled.order, `${document.type} void`)) {
                    return { document: deleted, order: settled.order, warning: "SHEET_FAILED" };
                }

                return { document: deleted, order: settled.order };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),
});
