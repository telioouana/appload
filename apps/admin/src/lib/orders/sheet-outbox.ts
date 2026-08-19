import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { orderDocument, sheetSync, type DocumentParty, type NoteReason, type Order } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import { OrderError } from "@/lib/orders/errors";
import { NOTE_TYPES } from "@/lib/orders/note-currency";
import { paymentSums } from "@/lib/orders/payment-sums";
import { applyDocumentSums } from "@/lib/orders/document-sums";
import {
    appendRow,
    appendTableRow,
    findRowByOrderId,
    findSheetTable,
    getRange,
    getRangeFormulas,
    isFormula,
    updateRow,
} from "@/lib/orders/sheets-client";
import {
    HEADER_ROW,
    SHEET_NAME,
    TABLE_NAME,
    columnLetter,
    orderToSheetCells,
    resolveColumns,
    type NoteBlock,
    type SheetCellOptions,
} from "@/lib/orders/orders-sheet-mapping";

/**
 * The legs whose paid block is derived from proofs of payment — the sheet
 * writer may clear their "Full Payment Date" cell, which it never does for
 * hand-entered legs.
 */
export async function popGovernedParties(db: typeof Database, orderPk: string): Promise<Set<DocumentParty>> {
    const sums = await paymentSums(db, orderPk);
    const governed = new Set<DocumentParty>();

    if (sums.shipper.governed) governed.add("shipper");
    if (sums.carrier.governed) governed.add("carrier");

    return governed;
}

/**
 * The sheet has ONE note block per party (kind, reason, subtotal, VAT,
 * total); the app allows any number of debit/credit notes. The block is
 * the net position of the live notes: debit − credit, written as a Debit
 * when positive and a Credit when negative, nothing when they cancel out.
 * The reason is kept only when every live note agrees on it — otherwise
 * the sheet shows "Other" and the notes themselves hold the detail.
 */
export async function noteBlocks(db: typeof Database, orderPk: string): Promise<Partial<Record<DocumentParty, NoteBlock>>> {
    const rows = await db
        .select({
            type: orderDocument.type,
            party: orderDocument.party,
            subtotal: sql<string | null>`sum(${orderDocument.subtotal})`,
            vat: sql<string | null>`sum(${orderDocument.vat})`,
            total: sql<string | null>`sum(${orderDocument.total})`,
            reasons: sql<(NoteReason | null)[]>`array_agg(distinct ${orderDocument.reasonCode})`,
        })
        .from(orderDocument)
        .where(and(
            eq(orderDocument.orderId, orderPk),
            isNull(orderDocument.deletedAt),
            inArray(orderDocument.type, [...NOTE_TYPES]),
        ))
        .groupBy(orderDocument.type, orderDocument.party);

    const blocks: Partial<Record<DocumentParty, NoteBlock>> = {};
    const reasonsByParty: Partial<Record<DocumentParty, Set<NoteReason | null>>> = {};
    const sign = (type: string) => (type === "debit-note" ? 1 : -1);
    const num = (value: string | null) => (value === null ? 0 : Number(value));

    for (const row of rows) {
        if (!row.party) continue;

        const block = blocks[row.party] ?? { kind: null, reason: null, subtotal: 0, vat: 0, total: 0 };
        block.subtotal = (block.subtotal ?? 0) + sign(row.type) * num(row.subtotal);
        block.vat = (block.vat ?? 0) + sign(row.type) * num(row.vat);
        block.total = (block.total ?? 0) + sign(row.type) * num(row.total);
        blocks[row.party] = block;

        const reasons = reasonsByParty[row.party] ?? new Set<NoteReason | null>();
        for (const reason of row.reasons ?? []) reasons.add(reason);
        reasonsByParty[row.party] = reasons;
    }

    for (const party of Object.keys(blocks) as DocumentParty[]) {
        const block = blocks[party]!;
        const total = Math.round((block.total ?? 0) * 100) / 100;

        if (total === 0) {
            blocks[party] = { kind: null, reason: null, subtotal: null, vat: null, total: null };
            continue;
        }

        const reasons = [...(reasonsByParty[party] ?? [])];
        const onlyReason = reasons.length === 1 ? reasons[0] : null;

        blocks[party] = {
            kind: total > 0 ? "Debit" : "Credit",
            reason: onlyReason ?? null,
            subtotal: Math.abs(block.subtotal ?? 0),
            vat: Math.abs(block.vat ?? 0),
            total: Math.abs(total),
        };
    }

    return blocks;
}

/** Everything pushOrderToSheets needs beyond the order row itself. */
export async function sheetCellOptions(db: typeof Database, orderPk: string): Promise<SheetCellOptions> {
    const [popGoverned, notes] = await Promise.all([popGovernedParties(db, orderPk), noteBlocks(db, orderPk)]);

    return { popGovernedParties: popGoverned, notes };
}

/**
 * Appends the Order Id into the ORDERS table body (the table grows to hold
 * the row) and returns the new row's 1-based index. Falls back to a plain
 * values append when the tab is not a Sheets Table.
 */
async function appendOrderRow(accessToken: string, orderId: string): Promise<number> {
    const table = await findSheetTable(accessToken, SHEET_NAME, TABLE_NAME);

    if (table) {
        await appendTableRow(accessToken, table, [orderId]);
    } else {
        await appendRow(accessToken, SHEET_NAME, `A${HEADER_ROW}`, [orderId]);
    }

    const rowIndex = await findRowByOrderId(accessToken, SHEET_NAME, orderId);

    if (rowIndex === null) {
        throw new OrderError("SHEET_FAILED", `Appended ${orderId} but could not find its row`);
    }

    return rowIndex;
}

/**
 * Pushes one order's full state to the ORDERS sheet: the row is updated in
 * place, or appended when missing — which also makes the retry cron heal
 * orders whose creation-time append failed.
 *
 * Formula cells are never overwritten: on an existing row every cell that
 * currently holds a formula is skipped, whatever column it sits in; on a
 * new row the formulas of the row above are copied into the columns the
 * app does not own (structured references are row-relative), so the new
 * row computes like its neighbours.
 */
export async function pushOrderToSheets(
    accessToken: string,
    updated: Order,
    options: SheetCellOptions = {},
): Promise<void> {
    const [headerRow] = await getRange(accessToken, SHEET_NAME, `${HEADER_ROW}:${HEADER_ROW}`);
    const columns = resolveColumns(headerRow ?? []);
    const lastColumn = columnLetter(columns.width - 1);
    const cells = orderToSheetCells(updated, columns, options);
    const owned = new Set(columns.index.values());

    const existingRow = await findRowByOrderId(accessToken, SHEET_NAME, updated.orderId);

    if (existingRow === null) {
        const rowIndex = await appendOrderRow(accessToken, updated.orderId);
        const neighbour = rowIndex - 1;

        if (neighbour > HEADER_ROW) {
            const [formulas = []] = await getRangeFormulas(accessToken, SHEET_NAME, `A${neighbour}:${lastColumn}${neighbour}`);

            formulas.forEach((cell, index) => {
                if (!owned.has(index) && isFormula(cell)) cells[index] = cell;
            });
        }

        await updateRow(accessToken, SHEET_NAME, rowIndex, lastColumn, cells);
        return;
    }

    const [current = []] = await getRangeFormulas(accessToken, SHEET_NAME, `A${existingRow}:${lastColumn}${existingRow}`);

    current.forEach((cell, index) => {
        if (isFormula(cell)) cells[index] = null;
    });

    await updateRow(accessToken, SHEET_NAME, existingRow, lastColumn, cells);
}

/** Upserts the outbox row: done resets the counter, failed increments it. */
export async function recordSheetSync(
    db: typeof Database,
    orderPk: string,
    state: "done" | "failed",
    lastError?: string,
): Promise<void> {
    await db
        .insert(sheetSync)
        .values({
            orderId: orderPk,
            state,
            attempts: state === "failed" ? 1 : 0,
            lastError: lastError ?? null,
        })
        .onConflictDoUpdate({
            target: sheetSync.orderId,
            set: {
                state,
                lastError: lastError ?? null,
                attempts: state === "failed" ? sql`${sheetSync.attempts} + 1` : 0,
                updatedAt: new Date(),
            },
        });
}

/**
 * Outbox marker: a note/proof-of-payment row is committed but the order's
 * derived money block (note sums, remaining, POP paid columns) could not be
 * rebuilt — the write lost the optimistic lock on every attempt, or failed
 * midway. Nothing else rebuilds the note sums, so whoever next pushes this
 * order (syncSheetsAndRecord, the sheet-sync cron) re-derives it first.
 */
export const RECOMPUTE_CONFLICT = "RECOMPUTE_CONFLICT";

/**
 * Flags the order for re-derivation. The attempts counter is reset: the
 * re-derivation is a cheap DB-only step and must not be starved by earlier
 * Sheets failures on the same order.
 */
export async function markRecomputePending(db: typeof Database, orderPk: string): Promise<void> {
    await db
        .insert(sheetSync)
        .values({ orderId: orderPk, state: "failed", attempts: 0, lastError: RECOMPUTE_CONFLICT })
        .onConflictDoUpdate({
            target: sheetSync.orderId,
            set: { state: "failed", lastError: RECOMPUTE_CONFLICT, attempts: 0, updatedAt: new Date() },
        });
}

export async function isRecomputePending(db: typeof Database, orderPk: string): Promise<boolean> {
    const [row] = await db
        .select({ lastError: sheetSync.lastError })
        .from(sheetSync)
        .where(eq(sheetSync.orderId, orderPk));

    return row?.lastError === RECOMPUTE_CONFLICT;
}

/**
 * Never-throws wrapper used by every mutation: push, record the outcome in
 * the outbox (the retry cron sweeps failures), report success. The caller
 * only downgrades to a SHEET_FAILED warning — the mutation itself already
 * committed.
 *
 * An order flagged RECOMPUTE_CONFLICT is re-derived before the push: the
 * caller's row predates the re-derivation, and recording "done" on a stale
 * block would bury the marker for good. Callers already invalidate the
 * order query on the client, so the fresher row is picked up there.
 */
export async function syncSheetsAndRecord(
    db: typeof Database,
    accessToken: string,
    updated: Order,
): Promise<boolean> {
    let pending = false;
    let rederived = false;

    try {
        pending = await isRecomputePending(db, updated.id);
        const current = pending ? await applyDocumentSums(db, updated.id) : updated;
        rederived = pending;

        await pushOrderToSheets(accessToken, current, await sheetCellOptions(db, updated.id));
        await recordSheetSync(db, updated.id, "done");
        return true;
    } catch (error) {
        console.error(`sheet sync failed for ${updated.orderId}`, error);
        const message = error instanceof Error ? error.message : String(error);
        // A re-derivation that did not land keeps its marker; only a
        // completed one hands over to the plain sheet-error path
        const lastError = pending && !rederived ? RECOMPUTE_CONFLICT : message;
        await recordSheetSync(db, updated.id, "failed", lastError).catch(() => undefined);
        return false;
    }
}
