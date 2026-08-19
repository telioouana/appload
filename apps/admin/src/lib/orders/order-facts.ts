import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderHistory, type Location, type Order } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import type { NoteOrderPatch } from "./note-reasons";

/**
 * Facts a document carries about the order — an invoice's number/date, a
 * demurrage note's stage and days, a damage note's share. Only
 * Date-or-scalar columns travel here; jsonb never does.
 */
export type OrderFieldPatch = NoteOrderPatch & Partial<Pick<
    Order,
    "shipperInvoiceNumber" | "shipperInvoiceDate" | "carrierInvoiceNumber" | "carrierInvoiceDate"
>>;

export type ChangedFields = Record<string, { from: unknown; to: unknown }>;

// Compact, human-readable rendering for the history diff: dates as ISO,
// addresses by their display string, long text truncated. Never store the
// raw jsonb blobs — the diff is for the timeline, not for replay.
export function displayValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === "object" && "address" in value) return (value as Location).address;
    if (typeof value === "string" && value.length > 200) return `${value.slice(0, 200)}…`;
    return value ?? null;
}

/** Field-level diff of a sparse patch against the stored row. */
export function diffChangedFields(current: Order, patch: Record<string, unknown>): ChangedFields {
    const changed: ChangedFields = {};

    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;

        const from = displayValue((current as unknown as Record<string, unknown>)[key]);
        const to = displayValue(value);

        // Numeric columns come back as strings; compare displayed values
        if (String(from) !== String(to)) {
            changed[key] = { from, to };
        }
    }

    return changed;
}

/** The subset of `fields` that differs from the row, plus its history diff */
export function changedOrderFields(current: Order, fields: OrderFieldPatch) {
    const changed = diffChangedFields(current, fields);
    const patch = Object.fromEntries(
        Object.entries(fields).filter(([key]) => key in changed),
    ) as OrderFieldPatch;

    return { patch, changed };
}

const ORDER_FIELDS_APPLY_ATTEMPTS = 3;

/**
 * Writes a document's facts onto the order row under the optimistic lock
 * (re-read + retry: the values are the operator's, not derived), with the
 * same field-diff history row order.update writes. Only changed values are
 * applied; an unchanged echo is a no-op and returns null so the caller can
 * skip the sheet push. Money documents fold their facts into
 * applyDocumentSums' single locked write instead — this is the invoice
 * upload path.
 */
export async function applyOrderFields(
    db: typeof Database,
    orderPk: string,
    fields: OrderFieldPatch,
    actorUserId: string,
): Promise<Order | null> {
    for (let attempt = 0; attempt < ORDER_FIELDS_APPLY_ATTEMPTS; attempt++) {
        const [current] = await db.select().from(order).where(eq(order.id, orderPk));

        if (!current) {
            throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
        }

        const { patch, changed } = changedOrderFields(current, fields);

        if (Object.keys(patch).length === 0) {
            return null;
        }

        const [updated] = await db
            .update(order)
            .set({ ...patch, version: sql`${order.version} + 1` })
            .where(and(eq(order.id, orderPk), eq(order.version, current.version)))
            .returning();

        if (updated) {
            await db.insert(orderHistory).values({
                orderId: orderPk,
                actorUserId,
                kind: "update",
                changedFields: changed,
            });
            return updated;
        }
    }

    throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
}
