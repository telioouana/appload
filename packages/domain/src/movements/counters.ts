import "server-only";

/**
 * Where a reference number comes from.
 *
 * One row per (organization, kind, year) holds the last number handed out,
 * and a reference is minted by one statement that bumps it and returns the
 * new value. That is the whole concurrency story: neon-http has no
 * transactions, so two members filing a load at the same moment cannot be
 * serialized by reading then writing — the database has to do both at once.
 *
 * Gaps are acceptable and expected: a number minted for a write that then
 * failed is never handed out again. A reference is a name, not a count.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movement, organizationCounter } from "@workspace/db/movements";
import type { ReferenceKind } from "@workspace/db/types";
import { periodKey } from "@workspace/domain/subscription";
import { formatReference } from "@workspace/domain/movements/refs";

type Db = typeof Database;

/**
 * The Maputo calendar year a reference belongs to — the same business clock
 * the tracking allowance runs on, so a load filed at 01:00 on the first of
 * January in Maputo is that year's 0001 wherever the server happens to run.
 */
export const referenceYear = (at: Date = new Date()): number => Number(periodKey(at).slice(0, 4));

/**
 * The next reference for this company, kind and year: "ORD-0001-26".
 *
 * One statement. `values(… 1)` is the first number of a year and the
 * `do update` is every one after it, so the insert and the bump are the same
 * round trip and two callers can never read the same `last`.
 */
export async function nextReference(
    db: Db,
    organizationId: string,
    kind: ReferenceKind,
    at: Date = new Date(),
): Promise<string> {
    const year = referenceYear(at);

    const [row] = await db
        .insert(organizationCounter)
        .values({ organizationId, kind, year, last: 1 })
        .onConflictDoUpdate({
            target: [organizationCounter.organizationId, organizationCounter.kind, organizationCounter.year],
            set: { last: sql`${organizationCounter.last} + 1` },
        })
        .returning({ last: organizationCounter.last });

    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    return formatReference(kind, row.last, year);
}

/**
 * The ORD number of a load that is committed to, minted if it has none.
 *
 * The update is conditional on `reference is null`, so a second caller racing
 * the first writes nothing and reads back what the winner stored — its own
 * minted number is simply a gap. The year is the one the load was filed in,
 * not today's: a load created in December and booked in January keeps its
 * year, the same rule the renumbering script applies.
 */
export async function ensureOrderReference(
    db: Db,
    row: { id: string; organizationId: string; reference: string | null; createdAt: Date },
): Promise<string> {
    if (row.reference !== null) return row.reference;

    const reference = await nextReference(db, row.organizationId, "ORD", row.createdAt);

    const [updated] = await db
        .update(movement)
        .set({ reference })
        .where(and(eq(movement.id, row.id), isNull(movement.reference)))
        .returning({ reference: movement.reference });

    if (updated?.reference) return updated.reference;

    // Somebody else got there first; theirs is the one the load is called by
    const [current] = await db
        .select({ reference: movement.reference })
        .from(movement)
        .where(eq(movement.id, row.id))
        .limit(1);

    return current?.reference ?? reference;
}
