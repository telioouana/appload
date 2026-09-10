/**
 * The reference a movement is known by.
 *
 * One sequence serves both shapes, so a Trip that becomes an Order keeps the
 * number it was filed under and only its prefix changes — the load is the
 * same load, and a company that wrote "TRP-41" on a delivery note must still
 * be able to find it.
 */

import type { MovementExecution } from "@workspace/db/movements";

/** "TRP-41" for a movement my own fleet runs, "ORD-41" for one a partner does. */
export const movementRef = (seq: number, execution: MovementExecution): string =>
    `${execution === "partner" ? "ORD" : "TRP"}-${seq}`;
