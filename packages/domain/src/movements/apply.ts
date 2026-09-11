import "server-only";

/**
 * The one door for a movement's status.
 *
 * It must never become — or call — the Appload order door
 * (orders/transition.ts). That door writes order_history, which the portal's
 * notification materializer tails for Appload's own events; it defers a
 * sheet_sync row into the Google logbook; it runs the KYC gate that exists
 * for Appload's liability on an Appload booking; and it derives Appload's
 * commission. None of that may happen to a tenant's own load. The two doors
 * share exactly two things — the monthly tracked-movement allowance
 * (subscription.ts) and notify() — and the lint rule on this folder keeps it
 * that way.
 *
 * Every move is a compare-and-set on the row's version, the handshake the
 * order row uses: two members of one company acting on the same load from
 * two tabs, and whoever gets there second is told the load changed rather
 * than silently overwriting the first.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import {
    movement,
    movementEvent,
    type Movement,
    type MovementEventKind,
    type MovementStatus,
} from "@workspace/db/movements";
import type { NotificationKind } from "@workspace/db/notifications";

import { legSettled } from "@workspace/domain/movements/money";
import { isOnPortal, MAX_HOPS, organizationName, parentMovement } from "@workspace/domain/movements/link";
import { movementRef } from "@workspace/domain/movements/refs";
import { isTerminal, ownerTargets, transitionBlocker, upstreamStatus } from "@workspace/domain/movements/status";
import { notify } from "@workspace/domain/notifications";
import { assertTrackingAllowance, recordTrackingUsage } from "@workspace/domain/subscription";
import { place } from "@workspace/domain/tracking/slot";

type Db = typeof Database;

/** Who is acting: the company, and the member of it who clicked. */
export type MovementActor = { organizationId: string; userId: string };

/** One line of a movement's trail. */
export async function recordEvent(
    db: Db,
    input: {
        movementId: string;
        kind: MovementEventKind;
        /** Null when nobody did it: a status carried up from the row below */
        actor: MovementActor | null;
        fromStatus?: MovementStatus | null;
        toStatus?: MovementStatus | null;
        note?: string | null;
        metadata?: Record<string, string | number | boolean | null>;
    },
): Promise<void> {
    await db.insert(movementEvent).values({
        movementId: input.movementId,
        actorUserId: input.actor?.userId ?? null,
        actorOrgId: input.actor?.organizationId ?? null,
        kind: input.kind,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        note: input.note?.trim() || null,
        metadata: input.metadata ?? null,
    });
}

/** What a status stamps on the row besides itself. */
export function statusStamps(to: MovementStatus, now: Date): Partial<typeof movement.$inferInsert> {
    switch (to) {
        case "in-transit": return { startedAt: now };
        // A truck that arrived, or a load that will never leave, has nothing
        // left to report — the cron stops asking the moment this is written
        case "delivered": return { deliveredAt: now, trackingEnabled: false };
        case "cancelled": return { trackingEnabled: false };
        case "closed": return { closedAt: now };
        default: return {};
    }
}

/** The notification a status is, when it is one anybody else hears about. */
const KIND_FOR: Partial<Record<MovementStatus, NotificationKind>> = {
    "in-transit": "movement.started",
    "delivered": "movement.delivered",
    "cancelled": "movement.cancelled",
    "declined": "movement.declined",
};

/**
 * The milestones a client hears about. How the owner sources its truck —
 * who declined, who it asked next — is the owner's business; the client is
 * waiting on the load, not on the owner's procurement.
 */
const CLIENT_KINDS: readonly NotificationKind[] = ["movement.started", "movement.delivered", "movement.cancelled"];

/** Loud ones: somebody has to act today. */
const EMAIL_KINDS: readonly NotificationKind[] = ["movement.cancelled", "movement.declined"];

/**
 * Tells the other companies on a load that it moved. The client of the row,
 * when there is one and it did not do this itself; the owner, when the move
 * came from below; the executor, when an offer in front of it was called off.
 */
export async function announce(
    db: Db,
    row: Movement,
    opts: { actorOrgId: string | null; notifyOwner: boolean; notifyExecutor: boolean },
): Promise<void> {
    const kind = KIND_FOR[row.status];
    if (!kind) return;

    const params = {
        ref: movementRef(row.seq, row.execution),
        origin: place(row.origin),
        destination: place(row.destination),
    };
    const email = EMAIL_KINDS.includes(kind);
    const entity = { entityType: "movement", entityId: row.id } as const;

    if (row.clientOrgId && row.clientOrgId !== opts.actorOrgId && CLIENT_KINDS.includes(kind)) {
        await notify(db, {
            organizationId: row.clientOrgId,
            kind,
            email,
            ...entity,
            params: { ...params, organizationName: await organizationName(db, row.organizationId) },
        });
    }

    if (opts.notifyOwner) {
        await notify(db, {
            organizationId: row.organizationId,
            kind,
            email,
            ...entity,
            params: {
                ...params,
                organizationName: opts.actorOrgId ? await organizationName(db, opts.actorOrgId) : "",
            },
        });
    }

    if (opts.notifyExecutor && row.carrierOrgId) {
        await notify(db, {
            organizationId: row.carrierOrgId,
            kind,
            email,
            ...entity,
            params: { ...params, organizationName: await organizationName(db, row.organizationId) },
        });
    }
}

/**
 * Moves one row the owner may move. Offers and their answers go through
 * offer.ts instead; everything else — scheduling, starting, delivering,
 * calling a load off, closing the books — comes through here.
 */
export async function transitionMovement(
    db: Db,
    actor: MovementActor,
    input: { id: string; to: MovementStatus; expectedVersion: number; note?: string | null },
): Promise<Movement> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(eq(movement.id, input.id), eq(movement.organizationId, actor.organizationId)))
        .limit(1);

    // Never a 403: telling a stranger a load exists is already telling them something
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    if (row.version !== input.expectedVersion) {
        throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
    }

    const executorOnPortal = row.execution === "partner" && await isOnPortal(db, row.carrierOrgId);
    const targets = ownerTargets({
        execution: row.execution,
        status: row.status,
        linked: row.executionMovementId !== null,
        executorOnPortal,
    });

    if (!targets.includes(input.to)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    const blocker = transitionBlocker(
        {
            ...row,
            sellSettled: legSettled(row.sellTotal, row.sellSettlement),
            buySettled: row.execution === "own-fleet" || legSettled(row.buyTotal, row.buySettlement),
        },
        input.to,
        input.note,
    );

    if (blocker) throw new TRPCError({ code: "PRECONDITION_FAILED", message: blocker });

    // Starting a truck is what a plan pays for, checked before anything is
    // written so a refusal never leaves a half-started load behind
    if (input.to === "in-transit") {
        await assertTrackingAllowance(db, actor.organizationId);
    }

    const now = new Date();

    const [updated] = await db
        .update(movement)
        .set({
            status: input.to,
            version: sql`${movement.version} + 1`,
            ...statusStamps(input.to, now),
        })
        .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
        .returning();

    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    await recordEvent(db, {
        movementId: row.id,
        kind: "status",
        actor,
        fromStatus: row.status,
        toStatus: input.to,
        note: input.note,
    });

    if (input.to === "in-transit") {
        await recordTrackingUsage(db, {
            organizationIds: [actor.organizationId],
            entityType: "movement",
            entityId: row.id,
        });
    }

    await announce(db, updated, {
        actorOrgId: actor.organizationId,
        notifyOwner: false,
        // An offer in front of a partner was taken off the table
        notifyExecutor: row.status === "offered" && input.to === "cancelled",
    });

    // Calling off a linked load calls off the chain below it, before any
    // truck of theirs leaves for a job that no longer exists
    if (input.to === "cancelled" && row.executionMovementId) {
        await cancelDown(db, updated, now);
    }

    // And a milestone on this row is a milestone on the orders above it
    await propagateUp(db, updated, now);

    return updated;
}

/**
 * Carries a row's milestone to the order it executes, and on up the chain.
 * No allowance is asserted on the way: the truck is already rolling, and a
 * load must stay movable when some company's month runs out under it — each
 * row above is still billed once, as it passes into transit, because each
 * company is separately having a truck watched on its behalf.
 */
export async function propagateUp(db: Db, child: Movement, now: Date, hop = 0): Promise<void> {
    if (hop >= MAX_HOPS) {
        console.warn(`movement propagation from ${child.id} stopped after ${MAX_HOPS} hops`);
        return;
    }

    const parent = await parentMovement(db, child.id);
    if (!parent) return;

    const next = upstreamStatus(parent.status, child.status);
    if (!next) return;

    const [moved] = await db
        .update(movement)
        .set({
            status: next.status,
            version: sql`${movement.version} + 1`,
            ...statusStamps(next.status, now),
            // The executor backed out before leaving: the load goes back to
            // its owner to place again, which needs the link released
            ...(next.unlink && { executionMovementId: null, respondedAt: now }),
        })
        .where(and(
            eq(movement.id, parent.id),
            eq(movement.status, parent.status),
            eq(movement.executionMovementId, child.id),
        ))
        .returning();

    // The parent moved between the read and the write; that move decided
    if (!moved) return;

    await recordEvent(db, {
        movementId: parent.id,
        kind: "system",
        actor: null,
        fromStatus: parent.status,
        toStatus: next.status,
        // A code, never the executor's own note: why a company cancelled its
        // row is its business, and it can tell its client in its own words
        note: next.unlink ? "EXECUTOR_WITHDREW" : null,
    });

    if (next.status === "in-transit") {
        await recordTrackingUsage(db, {
            organizationIds: [parent.organizationId],
            entityType: "movement",
            entityId: parent.id,
        });
    }

    await announce(db, moved, { actorOrgId: child.organizationId, notifyOwner: true, notifyExecutor: false });

    if (!next.unlink) await propagateUp(db, moved, now, hop + 1);
}

/**
 * Calls off the rows below a cancelled order. Only rows that have not left:
 * the owner can cancel a linked load only while it is scheduled, and a
 * child that raced into transit in between has already decided the question.
 */
async function cancelDown(db: Db, parent: Movement, now: Date, hop = 0): Promise<void> {
    if (hop >= MAX_HOPS || !parent.executionMovementId) return;

    const [child] = await db
        .select()
        .from(movement)
        .where(eq(movement.id, parent.executionMovementId))
        .limit(1);

    if (!child || isTerminal(child.status) || child.status === "in-transit" || child.status === "delivered") return;

    const [moved] = await db
        .update(movement)
        .set({ status: "cancelled", version: sql`${movement.version} + 1`, ...statusStamps("cancelled", now) })
        .where(and(eq(movement.id, child.id), eq(movement.status, child.status)))
        .returning();

    if (!moved) return;

    await recordEvent(db, {
        movementId: child.id,
        kind: "system",
        actor: null,
        fromStatus: child.status,
        toStatus: "cancelled",
        note: "CLIENT_CANCELLED",
    });

    await notify(db, {
        organizationId: child.organizationId,
        kind: "movement.cancelled",
        email: true,
        entityType: "movement",
        entityId: child.id,
        params: {
            ref: movementRef(child.seq, child.execution),
            origin: place(child.origin),
            destination: place(child.destination),
            organizationName: await organizationName(db, parent.organizationId),
        },
    });

    await cancelDown(db, moved, now, hop + 1);
}
