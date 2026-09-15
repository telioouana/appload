import "server-only";

import { eq, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Database } from "@workspace/db/db";
import { movement } from "@workspace/db/movements";
import { order } from "@workspace/db/orders";
import type { ThreadSubject } from "@workspace/db/types";

import type { Actor } from "@workspace/domain/orders/actor";
import { isExecutorOf } from "@workspace/domain/movements/policy";
import { movementRef } from "@workspace/domain/movements/refs";

/**
 * Who a thread belongs to, read from the subject row rather than from the
 * thread.
 *
 * A thread hangs off a shipment, and the shipment is what says who its
 * parties are today: a carrier joins an order's thread the moment the order
 * is booked, and leaves it if the booking is undone. `thread_participant`
 * records those sides so an unread count is one query, but it is a cache of
 * this answer — never the authority.
 *
 * A side is an organization or Appload staff, and `staff` is the only thing
 * that says which: `thread_participant.organization_id` is nullable (a
 * deleted organization), and reading "no organization" as "staff" would hand
 * an ops-only thread to nobody, or worse, a tenant row to everybody.
 */
export type ThreadSides = {
    /** The organizations that read and write this thread */
    orgIds: string[];
    /** Whether Appload ops are a party — true on orders, false on portal loads */
    staff: boolean;
};

/** What a thread is about, normalized to the ids the thread row is keyed on. */
export type ThreadSubjectRef = {
    subjectType: ThreadSubject;
    subjectId: string;
};

export type ResolvedThreadSubject = {
    subject: ThreadSubjectRef;
    sides: ThreadSides;
    /** What the shipment is known by — the order id, or the load's reference */
    label: string;
    /**
     * How the executing partner knows the same load: its own row, written
     * when it accepted the offer. That is the page its notifications open and
     * the reference it reads — the owner's row appears in none of its lists.
     * Null on an order, and on a load nobody has accepted.
     */
    executor: { organizationId: string; subjectId: string; label: string } | null;
};

/** The executor's row, read beside the owner's in one go. */
const linked = alias(movement, "linked_movement");

const selectMovement = (db: typeof Database, where: SQL) =>
    db
        .select({
            id: movement.id,
            seq: movement.seq,
            execution: movement.execution,
            status: movement.status,
            organizationId: movement.organizationId,
            clientOrgId: movement.clientOrgId,
            carrierOrgId: movement.carrierOrgId,
            executionMovementId: movement.executionMovementId,
            linkedId: linked.id,
            linkedSeq: linked.seq,
            linkedExecution: linked.execution,
        })
        .from(movement)
        .leftJoin(linked, eq(linked.id, movement.executionMovementId))
        .where(where)
        .limit(1);

/**
 * The subject row behind an id, and the sides it gives the thread. Null when
 * there is no such shipment: the caller turns that into NOT_FOUND, which is
 * also what an outsider gets, so probing ids tells them nothing.
 *
 * An order is accepted under either of the two ids it is known by — the human
 * "APL-…" and the uuid primary key — and always normalized to the human one:
 * that is what the portal's URLs and the driver conversations already key on,
 * so one shipment can never end up with two threads.
 */
export async function resolveThreadSubject(
    db: typeof Database,
    subject: ThreadSubjectRef,
): Promise<ResolvedThreadSubject | null> {
    if (subject.subjectType === "order") {
        const [row] = await db
            .select({
                orderId: order.orderId,
                status: order.status,
                shipperId: order.shipperId,
                carrierId: order.carrierId,
            })
            .from(order)
            .where(or(eq(order.orderId, subject.subjectId), eq(order.id, subject.subjectId)))
            .limit(1);

        if (!row) return null;

        // The carrier is a party to the conversation only while it holds the
        // job: an order still being quoted has candidates, not a counterpart,
        // and the shipper's words to Appload are not theirs to read
        const orgIds = row.carrierId && row.status !== "prospect"
            ? [row.shipperId, row.carrierId]
            : [row.shipperId];

        return {
            subject: { subjectType: "order", subjectId: row.orderId },
            // Appload brokers the order, so ops are always in the room
            sides: { orgIds, staff: true },
            label: row.orderId,
            executor: null,
        };
    }

    // A subcontracted load is two rows — the owner's and the executor's — and
    // one conversation: the executor's row resolves to the owner's, which is
    // the one that names both companies. The seam is `executionMovementId`.
    //
    // A row in the middle of a chain — its owner both executes somebody's
    // order and has placed it with a partner of its own — therefore answers
    // with its upstream conversation, the one it is the executor of. Its
    // downstream conversation is the thread of the row below, reached with
    // that row's id.
    const [parent] = await selectMovement(db, eq(movement.executionMovementId, subject.subjectId));
    const row = parent ?? (await selectMovement(db, eq(movement.id, subject.subjectId)))[0];

    if (!row) return null;

    // A partner is a party only while it is actually on the load: withdrawing
    // an offer leaves `carrier_org_id` where it was, and that company stops
    // being shown the load everywhere else too (movements/policy.ts)
    const carrierOrgId = row.carrierOrgId && isExecutorOf(row, row.carrierOrgId) ? row.carrierOrgId : null;

    return {
        subject: { subjectType: "movement", subjectId: row.id },
        // A tenant's own books: Appload is not a party to them
        sides: {
            orgIds: carrierOrgId ? [row.organizationId, carrierOrgId] : [row.organizationId],
            staff: false,
        },
        label: movementRef(row.seq, row.execution),
        executor: carrierOrgId && row.linkedId && row.linkedSeq !== null && row.linkedExecution
            ? {
                organizationId: carrierOrgId,
                subjectId: row.linkedId,
                label: movementRef(row.linkedSeq, row.linkedExecution),
            }
            : null,
    };
}

/** Whether this caller is on one of the sides the subject gives the thread. */
export function threadAccess(actor: Actor, sides: ThreadSides): boolean {
    if (actor.kind === "staff") return sides.staff;

    return sides.orgIds.includes(actor.organizationId);
}
