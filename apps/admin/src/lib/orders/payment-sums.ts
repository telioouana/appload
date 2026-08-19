import "server-only";

import { and, eq } from "drizzle-orm";

import { orderDocument } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import { PROOF_OF_PAYMENT, emptyPaymentSums, type PaymentSums } from "./payments";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Per-party proof-of-payment sums for one order, rebuilt from source on
 * every call (never incremented): `governed` looks at every row, live or
 * voided; count / total / last paidAt only at live rows. A handful of rows
 * per order, served by order_document_order_type_idx.
 */
export async function paymentSums(db: typeof Database, orderPk: string): Promise<PaymentSums> {
    const rows = await db
        .select({
            party: orderDocument.party,
            total: orderDocument.total,
            paidAt: orderDocument.paidAt,
            deletedAt: orderDocument.deletedAt,
        })
        .from(orderDocument)
        .where(and(eq(orderDocument.orderId, orderPk), eq(orderDocument.type, PROOF_OF_PAYMENT)));

    const sums = emptyPaymentSums();

    for (const row of rows) {
        if (!row.party) continue;

        const party = sums[row.party];
        party.governed = true;

        if (row.deletedAt !== null) continue;

        party.liveCount += 1;
        party.paidTotal = round2(party.paidTotal + Number(row.total ?? 0));

        if (row.paidAt && (!party.lastPaidAt || row.paidAt > party.lastPaidAt)) {
            party.lastPaidAt = row.paidAt;
        }
    }

    return sums;
}
