import "server-only";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { orderDocument, type DocumentParty } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import { PROOF_OF_PAYMENT } from "./payments";

export const NOTE_TYPES = ["debit-note", "credit-note"] as const;

export const isNote = (type: string): type is (typeof NOTE_TYPES)[number] =>
    (NOTE_TYPES as readonly string[]).includes(type);

/**
 * Parties whose money documents are already folded into the order row:
 * live debit/credit notes (materialized note totals) and proofs of payment
 * (live or voided — a leg that ever had one is POP-governed and its paid
 * columns stay derived).
 *
 * Those columns hold bare numbers with no currency of their own — the sums
 * are grouped by (type, party) only — so the leg's currency is what gives
 * them meaning. Once a party has notes or proofs, repointing that leg would
 * silently reinterpret every stored total, the derived remaining amount and
 * the commission, so callers reject the change instead.
 */
export async function partiesWithMoneyDocuments(
    db: typeof Database,
    orderPk: string,
): Promise<Set<DocumentParty>> {
    const rows = await db
        .select({ party: orderDocument.party })
        .from(orderDocument)
        .where(and(
            eq(orderDocument.orderId, orderPk),
            or(
                and(inArray(orderDocument.type, [...NOTE_TYPES]), isNull(orderDocument.deletedAt)),
                eq(orderDocument.type, PROOF_OF_PAYMENT),
            ),
        ))
        .groupBy(orderDocument.party);

    return new Set(
        rows
            .map((row) => row.party)
            .filter((party): party is DocumentParty => party !== null),
    );
}

/**
 * Which of the two legs a patch would repoint to a different currency.
 * `undefined` on either field means "not being changed".
 */
export function changedCurrencyParties(
    patch: { shipperCurrency?: string | null; carrierCurrency?: string | null },
    current: { shipperCurrency: string | null; carrierCurrency: string | null },
): DocumentParty[] {
    const changed: DocumentParty[] = [];

    if (patch.shipperCurrency !== undefined && patch.shipperCurrency !== current.shipperCurrency) {
        changed.push("shipper");
    }

    if (patch.carrierCurrency !== undefined && patch.carrierCurrency !== current.carrierCurrency) {
        changed.push("carrier");
    }

    return changed;
}
