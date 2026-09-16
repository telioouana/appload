import "server-only";

/**
 * The seam between an Appload order and the two companies' own loads.
 *
 * It lives here rather than under movements/ because it is the one place
 * allowed to see both sides: packages/domain/eslint.config.js forbids
 * movements/** from importing the order doors, and for good reason — a load
 * in a company's books and a brokerage order are different records with
 * different lifecycles. This folder is the exception, and the only one.
 *
 * Everything here is best-effort and idempotent. neon-http has no
 * transactions, so a sync that fails after the order was written must be
 * repairable by the next transition — never by a rollback that cannot
 * happen.
 *
 * M0 declares the shapes; M2 fills the bodies.
 */

import type { db as Database } from "@workspace/db/db";
import type { Movement } from "@workspace/db/movements";
import type { Order } from "@workspace/db/orders";
import type { OrderStatus } from "@workspace/db/types";

import type { MovementActor } from "@workspace/domain/movements/apply";

type Db = typeof Database;

/**
 * Hands a load to Appload: creates the brokerage order behind the tenant's
 * own row and puts the row on it. The tenant keeps its load, its reference
 * and its books; what it gains is Appload's progress, tracking and chat.
 */
export async function offerToAppload(
    _db: Db,
    _actor: MovementActor,
    _input: { id: string; expectedVersion: number; message?: string | null },
): Promise<Movement> {
    throw new Error("M2: not implemented");
}

/**
 * Brings the rows linked to an order back in step with it: the orderer's row
 * for the shipper, the executor's for the carrier once it is booked, and the
 * dispatched driver and plates when there are any.
 *
 * `from` is the status the order was in before this move, null when it was
 * just created. `candidates: "settle"` cancels the carriers that were asked
 * and did not get it. Called after the order write, never before it, and its
 * failure never fails the caller.
 */
export async function syncApploadLinks(
    _db: Db,
    _params: { order: Order; from: OrderStatus | null; dispatch?: boolean; candidates?: "settle" },
): Promise<void> {
    throw new Error("M2: not implemented");
}

/** One offered row per portal carrier the order was sent to. */
export async function upsertApploadCandidates(
    _db: Db,
    _params: { orderPk: string; carrierOrgIds: string[] },
): Promise<void> {
    throw new Error("M2: not implemented");
}

/** The carrier answered with a price: its row is waiting on the decision. */
export async function markApploadCandidateQuoted(
    _db: Db,
    _params: { orderPk: string; carrierOrgId: string },
): Promise<void> {
    throw new Error("M2: not implemented");
}

/** The request to this carrier was taken back: its row is off. */
export async function withdrawApploadCandidate(
    _db: Db,
    _params: { orderPk: string; carrierOrgId: string },
): Promise<void> {
    throw new Error("M2: not implemented");
}

/** Nobody else is in the running: every live candidate row is cancelled. */
export async function closeApploadCandidates(
    _db: Db,
    _params: { orderPk: string; exceptOrgId?: string },
): Promise<void> {
    throw new Error("M2: not implemented");
}

/**
 * This company's own row for an order, by the display id ("APPL021.26") or
 * by the order's primary key. Null when it has none — an order of a company
 * that never activated the portal has no linked row at all.
 */
export async function linkedMovementId(
    _db: Db,
    _params: { orderId: string; organizationId: string },
): Promise<string | null> {
    throw new Error("M2: not implemented");
}
