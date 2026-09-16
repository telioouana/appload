import "server-only";

/**
 * The Order Id a portal-side create continues from.
 *
 * Admin mints its own, continuing from whichever is further ahead — the
 * database or the ORDERS sheet. The portal has no sheet to read, so its
 * sequence is the database's alone, and every one of its create doors wants
 * exactly the same callback. It is a callback rather than a value because the
 * unique (year, seq) index arbitrates concurrent creates: the retry needs a
 * freshly recomputed sequence, not the one that just lost.
 */

import { eq, max } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { order } from "@workspace/db/orders";

import type { OrderIdParts } from "@workspace/domain/orders/create";
import { currentOrderYear, nextOrderId } from "@workspace/domain/orders/order-id";

type Db = typeof Database;

export const portalNextOrderId = (
    db: Db,
    year: number = currentOrderYear(),
) => async (): Promise<OrderIdParts> => {
    const [row] = await db
        .select({ value: max(order.seq) })
        .from(order)
        .where(eq(order.year, year));

    return nextOrderId(row?.value ?? 0, 0, year);
};
