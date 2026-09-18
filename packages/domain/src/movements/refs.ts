/**
 * The reference a movement is known by.
 *
 * Per company, per kind, per year: "ORD-0001-26" is the first order company X
 * filed in 2026, and company Y's first is the same string in its own books.
 * A load still collecting offers is a "REQ-0001-26" and keeps it as history
 * once somebody commits and it takes the next ORD — the two live in separate
 * columns, so a delivery note written against either still finds the load.
 *
 * Nothing here derives a reference from `seq` any more: `seq` is insertion
 * order and nothing else. What the row stores is what it is called.
 */

import type { MovementStatus } from "@workspace/db/movements";
import type { ReferenceKind } from "@workspace/db/types";

/** What a row must carry for `movementRef` to name it. */
export type MovementRefRow = {
    reference: string | null;
    requestReference: string | null;
    clientReference?: string | null;
};

/** "ORD-0001-26" — 4-digit counter, 2-digit year. */
export const formatReference = (kind: ReferenceKind, n: number, year: number): string =>
    `${kind}-${String(n).padStart(4, "0")}-${String(year % 100).padStart(2, "0")}`;

/**
 * What to call this load. The company's own number first; the request it was
 * filed under while it was still collecting offers; then the reference the
 * client gave it, which is all an executor row linked to somebody else's
 * order may have; and an em dash when it has none of the three.
 */
export const movementRef = (row: MovementRefRow): string =>
    row.reference ?? row.requestReference ?? row.clientReference ?? "—";

/**
 * The same name, as the company merely carrying the load may be told it.
 *
 * `clientReference` is the reference the row's own client gave it, and it
 * names that client — which is why the projection strips the column for an
 * executor. It must not walk back in as the row's label either, so here the
 * fallback stops one step earlier and an unnumbered row is just "—".
 */
export const counterpartyRef = (row: MovementRefRow): string =>
    movementRef({ reference: row.reference, requestReference: row.requestReference });

/**
 * The statuses a load is committed on — somebody is moving it, so it is an
 * order and not a request, and it needs its ORD number before anything else
 * is written about it.
 */
const ORDER_REFERENCE_STATUSES = [
    "scheduled",
    "booked",
    "at-loading",
    "loading",
    "waiting-documents",
    "on-route",
    "stopped",
    "issue",
    "at-border",
    "at-offloading",
    "offloading",
    "delivered",
    "closed",
] as const satisfies readonly MovementStatus[];

/** Whether a load in this status must carry an ORD reference. */
export const needsOrderReference = (status: MovementStatus): boolean =>
    (ORDER_REFERENCE_STATUSES as readonly MovementStatus[]).includes(status);
