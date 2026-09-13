import "server-only";

/**
 * What the load's papers say about the load itself.
 *
 * One question so far: how many loading photos are still waiting for
 * somebody to validate them. The warehouse keeper at the client photographs
 * what goes on the truck and the manager who answers for the load approves
 * each one before it leaves; a truck that leaves with photos nobody looked at
 * still leaves (PHOTOS_UNAPPROVED is a flag, never a blocker — see
 * status.ts), and this is the number that raises it.
 *
 * It lives here rather than in status.ts because it is a read, and status.ts
 * is pure and ships to the browser. The door (apply.ts) counts on the row it
 * is moving; the detail counts on the row it reads the papers from.
 */

import { and, count, eq, isNull } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movementDocument } from "@workspace/db/movements";

type Db = typeof Database;

/** Loading photos filed on a row that nobody has approved yet. */
export async function unapprovedPhotos(db: Db, movementId: string): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(movementDocument)
        .where(and(
            eq(movementDocument.movementId, movementId),
            eq(movementDocument.type, "loading-photo"),
            isNull(movementDocument.approvedAt),
            isNull(movementDocument.deletedAt),
        ));

    return row?.value ?? 0;
}
