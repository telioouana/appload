import "server-only";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { supportAccessGrant, type SupportAccessGrant } from "@workspace/db/support";

type Db = typeof Database;

export const GRANT_DAYS = [1, 7, 30] as const;
export type GrantDays = (typeof GRANT_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The grant that opens the company's books right now, or null. */
export async function activeGrant(db: Db, organizationId: string, now = new Date()): Promise<SupportAccessGrant | null> {
    const [row] = await db
        .select()
        .from(supportAccessGrant)
        .where(and(eq(supportAccessGrant.organizationId, organizationId), isNull(supportAccessGrant.revokedAt), gt(supportAccessGrant.expiresAt, now)))
        .orderBy(desc(supportAccessGrant.expiresAt))
        .limit(1);

    return row ?? null;
}

/** The company's grants, newest first: the live one, and the record of the earlier ones. */
export function grantHistory(db: Db, organizationId: string, limit = 20): Promise<SupportAccessGrant[]> {
    return db
        .select()
        .from(supportAccessGrant)
        .where(eq(supportAccessGrant.organizationId, organizationId))
        .orderBy(desc(supportAccessGrant.createdAt))
        .limit(limit);
}

/**
 * Opens the books for `days`, with the reason the company gives. One live
 * grant at a time: a new one takes the place of the current one, so the
 * expiry on screen is always the one that applies.
 */
export async function grantSupport(
    db: Db,
    actor: { organizationId: string; userId: string },
    input: { days: GrantDays; reason: string },
): Promise<SupportAccessGrant> {
    const now = new Date();
    const current = await activeGrant(db, actor.organizationId, now);

    if (current) {
        await db
            .update(supportAccessGrant)
            .set({ revokedAt: now, revokedBy: actor.userId })
            .where(eq(supportAccessGrant.id, current.id));
    }

    const [row] = await db
        .insert(supportAccessGrant)
        .values({
            organizationId: actor.organizationId,
            grantedBy: actor.userId,
            reason: input.reason,
            expiresAt: new Date(now.getTime() + input.days * DAY_MS),
        })
        .returning();

    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    return row;
}

/** Takes a live grant back. A grant that is not this company's, or is already over, is NOT_FOUND. */
export async function revokeSupport(db: Db, actor: { organizationId: string; userId: string }, id: string): Promise<SupportAccessGrant> {
    const [row] = await db
        .update(supportAccessGrant)
        .set({ revokedAt: new Date(), revokedBy: actor.userId })
        .where(and(
            eq(supportAccessGrant.id, id),
            eq(supportAccessGrant.organizationId, actor.organizationId),
            isNull(supportAccessGrant.revokedAt),
            gt(supportAccessGrant.expiresAt, new Date()),
        ))
        .returning();

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    return row;
}
