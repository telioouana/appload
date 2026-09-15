import { eq, sql } from "drizzle-orm";

import { rateLimit } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";

/**
 * Counts one attempt against `key`, and answers whether it is allowed.
 *
 * Better Auth's own rate-limit table, reused: its keys are `<ip><path>`, so
 * a prefixed key of ours can never collide with them. Read-then-write is not
 * atomic on neon-http; a burst can overshoot by a request or two, which is
 * immaterial at the limits the callers set.
 */
export async function withinRateLimit(
    db: typeof Database,
    params: { key: string; windowMs: number; max: number },
): Promise<boolean> {
    const now = Date.now();

    const [current] = await db
        .select({ count: rateLimit.count, lastRequest: rateLimit.lastRequest })
        .from(rateLimit)
        .where(eq(rateLimit.id, params.key))
        .limit(1);

    const inWindow =
        current?.lastRequest != null && now - current.lastRequest < params.windowMs;

    if (inWindow && (current?.count ?? 0) >= params.max) return false;

    await db
        .insert(rateLimit)
        .values({ id: params.key, key: params.key, count: 1, lastRequest: now })
        .onConflictDoUpdate({
            target: rateLimit.id,
            set: {
                count: inWindow ? sql`${rateLimit.count} + 1` : 1,
                lastRequest: now,
            },
        });

    return true;
}
