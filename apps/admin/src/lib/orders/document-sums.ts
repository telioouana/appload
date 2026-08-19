import "server-only";

import { and, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDocument, orderHistory, type Order } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import { NOTE_TYPES } from "./note-currency";
import { remainingPatch } from "./totals";
import { proofPaymentPatch } from "./payments";
import { paymentSums } from "./payment-sums";
import { changedOrderFields, type OrderFieldPatch } from "./order-facts";

/** Optimistic-lock retries before giving up (each attempt re-reads the row) */
const RECOMPUTE_ATTEMPTS = 5;

/**
 * Rebuilds the four per-party note sums from the live note rows — always
 * recomputed from source (never incremented) so a retry, a void or a crash
 * can never leave the materialized sums drifted.
 */
export async function noteSums(db: typeof Database, orderPk: string) {
    const rows = await db
        .select({
            type: orderDocument.type,
            party: orderDocument.party,
            total: sum(orderDocument.total),
        })
        .from(orderDocument)
        .where(and(
            eq(orderDocument.orderId, orderPk),
            isNull(orderDocument.deletedAt),
            inArray(orderDocument.type, [...NOTE_TYPES]),
        ))
        .groupBy(orderDocument.type, orderDocument.party);

    const sums = {
        shipperDebitTotal: "0",
        shipperCreditTotal: "0",
        carrierDebitTotal: "0",
        carrierCreditTotal: "0",
    };

    for (const row of rows) {
        if (!row.party || row.total === null) continue;
        const key = `${row.party}${row.type === "debit-note" ? "Debit" : "Credit"}Total` as keyof typeof sums;
        sums[key] = row.total;
    }

    return sums;
}

/** Facts a money document carries about the order, written in the same locked update as the sums */
export type DocumentFacts = {
    fields: OrderFieldPatch;
    actorUserId: string;
};

/**
 * Recomputes and stores everything the order's money documents drive: the
 * note sums, the outstanding-payment columns they shift on legacy legs
 * (remainingPatch) and the full paid block of POP-governed legs
 * (proofPaymentPatch, spread last so it wins). A note's facts (demurrage
 * stage/days, damage share) ride in the same write, so the order can never
 * end up with the money applied but the facts missing, or vice versa.
 * Optimistically locked against concurrent editors and retried, because
 * the derived values are conflict-free (rebuilt from source each attempt).
 *
 * Throws VERSION_CONFLICT if every attempt loses the lock. Callers decide
 * what that means: the document mutations mark the order in the sheet
 * outbox (see markRecomputePending) because their document row is already
 * committed; the sheet sync re-runs this before pushing.
 */
export async function applyDocumentSums(
    db: typeof Database,
    orderPk: string,
    facts?: DocumentFacts,
): Promise<Order> {
    for (let attempt = 0; attempt < RECOMPUTE_ATTEMPTS; attempt++) {
        const [current] = await db.select().from(order).where(eq(order.id, orderPk));

        if (!current) {
            throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
        }

        const [notes, payments] = await Promise.all([
            noteSums(db, orderPk),
            paymentSums(db, orderPk),
        ]);

        const withNotes = { ...current, ...notes };
        const { patch: factPatch, changed } = facts
            ? changedOrderFields(current, facts.fields)
            : { patch: {} as OrderFieldPatch, changed: {} };

        const [updated] = await db
            .update(order)
            .set({
                ...notes,
                ...remainingPatch(withNotes),
                ...proofPaymentPatch(withNotes, payments),
                ...factPatch,
                version: sql`${order.version} + 1`,
            })
            .where(and(eq(order.id, orderPk), eq(order.version, current.version)))
            .returning();

        if (updated) {
            if (facts && Object.keys(changed).length > 0) {
                await db.insert(orderHistory).values({
                    orderId: orderPk,
                    actorUserId: facts.actorUserId,
                    kind: "update",
                    changedFields: changed,
                });
            }
            return updated;
        }
    }

    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
}
