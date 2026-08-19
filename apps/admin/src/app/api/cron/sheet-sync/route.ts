import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { order, sheetSync } from "@workspace/db/orders";

import { authorizeCron } from "@/lib/cron/verify";
import { RECOMPUTE_CONFLICT, pushOrderToSheets, recordSheetSync, sheetCellOptions } from "@/lib/orders/sheet-outbox";
import { applyDocumentSums } from "@/lib/orders/document-sums";
import { getServiceAccountAccessToken } from "@/lib/orders/service-account-token";

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 10;

// A full batch is ~6-9 sequential Google Sheets calls per order. 60 is the
// Vercel Hobby maximum — the sync is cursor-based, so the next run resumes
export const maxDuration = 60;

/**
 * Sweeps the sheet_sync outbox every 30 minutes (see
 * apps/admin/scripts/qstash-schedules.mjs) and retries failed/pending
 * pushes with the shared service-account token — no user session needed.
 * This is only a healer: every mutation already pushes inline. Rows that
 * exhausted MAX_ATTEMPTS are left for a human (the badge in the UI keeps
 * showing failed).
 *
 * A row marked RECOMPUTE_CONFLICT means a note/proof-of-payment write lost
 * the optimistic lock on every attempt: the document is committed but the
 * order's derived money block was not rebuilt. It is re-derived here from
 * source before the push, so the leg heals without another order write.
 * That re-derivation is DB-only, so marked rows are swept regardless of
 * how many Sheets attempts the order has already burnt.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const stale = await db
        .select({ orderId: sheetSync.orderId, attempts: sheetSync.attempts, lastError: sheetSync.lastError })
        .from(sheetSync)
        .where(and(
            inArray(sheetSync.state, ["pending", "failed"]),
            or(lt(sheetSync.attempts, MAX_ATTEMPTS), eq(sheetSync.lastError, RECOMPUTE_CONFLICT)),
        ))
        .limit(BATCH_SIZE);

    if (stale.length === 0) {
        return NextResponse.json({ retried: 0, healed: 0 });
    }

    const accessToken = await getServiceAccountAccessToken();

    let healed = 0;

    for (const row of stale) {
        const pending = row.lastError === RECOMPUTE_CONFLICT;
        let rederived = false;

        try {
            const current = pending
                ? await applyDocumentSums(db, row.orderId)
                : (await db.select().from(order).where(eq(order.id, row.orderId)))[0];
            rederived = pending;

            if (!current) {
                continue;
            }

            await pushOrderToSheets(accessToken, current, await sheetCellOptions(db, row.orderId));
            await recordSheetSync(db, row.orderId, "done");
            healed++;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A re-derivation that did not land (lock lost again, transient
            // DB error) keeps its marker so the next sweep re-derives instead
            // of pushing a stale block; an order that no longer exists cannot
            // be healed and drops the marker
            const keepMarker = pending && !rederived && message !== "NOT_FOUND";
            await recordSheetSync(db, row.orderId, "failed", keepMarker ? RECOMPUTE_CONFLICT : message).catch(() => undefined);
        }
    }

    console.log(`[cron:sheet-sync] retried=${stale.length} healed=${healed}`);

    return NextResponse.json({ retried: stale.length, healed });
}

// QStash delivers over POST; GET stays for manual runs with the bearer token
export const GET = handle;
export const POST = handle;
