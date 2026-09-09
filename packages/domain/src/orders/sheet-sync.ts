import "server-only";

import { sql } from "drizzle-orm";

import { sheetSync, type SheetSyncState } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

/**
 * The order write's view of the Sheets side: Admin hands the door a real
 * push (Google client, tokens and the sheet mapping all stay in the app),
 * the portal hands it "defer" and the outbox row alone, which the existing
 * sheet-sync cron then heals.
 */
export type SheetSyncResult = { ok: boolean; error?: string };

/** Upserts the outbox row: done resets the counter, failed increments it. */
export async function recordSheetSync(
    db: typeof Database,
    orderPk: string,
    state: SheetSyncState,
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
