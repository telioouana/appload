import "server-only";

/**
 * The moves between two companies: placing a load with a partner on the
 * platform, taking the offer back, the partner's answer, and turning a load
 * from one shape into the other.
 *
 * Kept apart from the status door because none of these is one row changing
 * its mind. An offer puts terms in front of another company; an acceptance
 * writes a row into that company's books. The status door knows nothing of
 * a second party, and these doors know nothing of trucks leaving.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movement, type Movement } from "@workspace/db/movements";
import { organization } from "@workspace/db/users";

import { recordEvent, type MovementActor } from "@workspace/domain/movements/apply";
import { isConnected, isOnPortal, organizationName } from "@workspace/domain/movements/link";
import { movementRef } from "@workspace/domain/movements/refs";
import { notify } from "@workspace/domain/notifications";
import { assertTrackingAllowance } from "@workspace/domain/subscription";
import { place } from "@workspace/domain/tracking/slot";

type Db = typeof Database;

async function loadOwn(db: Db, actor: MovementActor, id: string, expectedVersion: number): Promise<Movement> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(eq(movement.id, id), eq(movement.organizationId, actor.organizationId)))
        .limit(1);

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    if (row.version !== expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    return row;
}

/**
 * Whether a company can be handed a load: connected to the one handing it
 * over, and a transporter. Shared by the offer and by naming a partner on a
 * load in the first place — the check is on the organization id the server
 * has, never on anything the page says about it.
 */
export async function assertExecutor(db: Db, ownerOrgId: string, carrierOrgId: string): Promise<void> {
    const [row] = await db
        .select({ type: organization.type })
        .from(organization)
        .where(eq(organization.id, carrierOrgId))
        .limit(1);

    if (!row || row.type !== "carrier") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_A_CARRIER" });
    }

    if (!(await isConnected(db, ownerOrgId, carrierOrgId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
    }
}

/**
 * Places a load with a partner that can answer on the portal. The terms go
 * as they are on the row — route, cargo, dates and the price — and freeze
 * while the partner decides.
 */
export async function offerMovement(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number; message?: string | null },
): Promise<Movement> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    if (row.execution !== "partner" || row.executionMovementId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    if (row.status !== "procurement" && row.status !== "declined") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    if (!row.carrierOrgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NO_CARRIER" });
    if (!row.buyTotal || !row.buyCurrency) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NO_PRICE" });

    await assertExecutor(db, actor.organizationId, row.carrierOrgId);

    // Nobody on the portal to answer: the load is the owner's to schedule
    // directly, the way a partner off the platform always was
    if (!(await isOnPortal(db, row.carrierOrgId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_ON_PORTAL" });
    }

    // Placing a load commits the company to a tracked movement
    await assertTrackingAllowance(db, actor.organizationId);

    const now = new Date();

    const [updated] = await db
        .update(movement)
        .set({
            status: "offered",
            offeredAt: now,
            // A re-offer after a decline starts clean
            respondedAt: null,
            responseNote: null,
            version: sql`${movement.version} + 1`,
        })
        .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
        .returning();

    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    // The message travels on the trail, which the partner reads — there is
    // no column for it because it belongs to this one offer, not to the load
    await recordEvent(db, {
        movementId: row.id,
        kind: "offer",
        actor,
        fromStatus: row.status,
        toStatus: "offered",
        note: input.message,
        metadata: { action: "offered" },
    });

    await notify(db, {
        organizationId: row.carrierOrgId,
        kind: "movement.offered",
        email: true,
        entityType: "movement",
        entityId: row.id,
        params: {
            ref: movementRef(row.seq, row.execution),
            organizationName: await organizationName(db, actor.organizationId),
            origin: place(row.origin),
            destination: place(row.destination),
            // The partner's own money: what it would be paid
            total: Number(row.buyTotal),
            currency: row.buyCurrency,
        },
    });

    return updated;
}

/** Takes an unanswered offer back; the load returns to procurement. */
export async function withdrawOffer(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number },
): Promise<Movement> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    if (row.status !== "offered") throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });

    const [updated] = await db
        .update(movement)
        .set({ status: "procurement", offeredAt: null, version: sql`${movement.version} + 1` })
        .where(and(
            eq(movement.id, row.id),
            eq(movement.version, input.expectedVersion),
            eq(movement.status, "offered"),
        ))
        .returning();

    // The partner answered in between — the answer stands
    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    await recordEvent(db, {
        movementId: row.id,
        kind: "offer",
        actor,
        fromStatus: "offered",
        toStatus: "procurement",
        metadata: { action: "withdrawn" },
    });

    if (row.carrierOrgId) {
        await notify(db, {
            organizationId: row.carrierOrgId,
            kind: "movement.cancelled",
            email: false,
            entityType: "movement",
            entityId: row.id,
            params: {
                ref: movementRef(row.seq, row.execution),
                organizationName: await organizationName(db, actor.organizationId),
                origin: place(row.origin),
                destination: place(row.destination),
                reason: "withdrawn",
            },
        });
    }

    return updated;
}

/**
 * The executor's answer.
 *
 * A yes writes a row into the executor's own books: its own movement, its own
 * fleet, the owner as its client and the owner's price as what it will be
 * paid — and links the owner's order to it. Always a new row, never a shared
 * one: each row is owned by exactly one company and carries exactly that
 * company's two legs, so the owner never selects a column of the executor's
 * row and a leak of either side's money is impossible by construction rather
 * than by a filter somebody must remember.
 *
 * The claim and the copy are one SQL statement. If the owner withdrew or
 * edited the offer a moment earlier, the claim matches nothing and nothing is
 * written; if two members of the executor answer at once, the second finds
 * the offer already taken. There is no state in which the owner's order is
 * booked and the executor's row is missing, or the other way round. Postgres
 * checks the link's foreign key at the end of the statement, by which time
 * the row it points at exists.
 */
export async function respondToOffer(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number; decision: "accept" | "decline"; note?: string | null },
): Promise<{ movement: Movement; executorMovementId: string | null; executorRef: string | null }> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(
            eq(movement.id, input.id),
            eq(movement.carrierOrgId, actor.organizationId),
            eq(movement.status, "offered"),
        ))
        .limit(1);

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    if (row.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    const note = input.note?.trim() || null;
    const now = new Date();
    const ref = movementRef(row.seq, row.execution);
    const executorName = await organizationName(db, actor.organizationId);
    const common = { origin: place(row.origin), destination: place(row.destination) };

    if (input.decision === "decline") {
        const [updated] = await db
            .update(movement)
            .set({ status: "declined", respondedAt: now, responseNote: note, version: sql`${movement.version} + 1` })
            .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion), eq(movement.status, "offered")))
            .returning();

        if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

        await recordEvent(db, {
            movementId: row.id,
            kind: "offer",
            actor,
            fromStatus: "offered",
            toStatus: "declined",
            note,
            metadata: { action: "declined" },
        });

        await notify(db, {
            organizationId: row.organizationId,
            kind: "movement.declined",
            email: true,
            entityType: "movement",
            entityId: row.id,
            params: { ref, organizationName: executorName, ...common },
        });

        return { movement: updated, executorMovementId: null, executorRef: null };
    }

    // A connection that ended since the offer voids it
    if (!(await isConnected(db, row.organizationId, actor.organizationId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
    }

    // Saying yes commits the executor to a tracked movement of its own
    await assertTrackingAllowance(db, actor.organizationId);

    const executorId = crypto.randomUUID();
    // Naive UTC, the way drizzle writes every timestamp column in this repo
    const stamp = now.toISOString();

    // Every value in the SELECT list is cast: an INSERT ... SELECT gives a
    // parameter no target column to infer its type from
    const claimed = await db.execute<{ id: string; seq: number }>(sql`
        with claimed as (
            update ${movement}
            set status = 'scheduled',
                version = version + 1,
                responded_at = ${stamp}::timestamp,
                response_note = ${note}::text,
                execution_movement_id = ${executorId}::text,
                updated_at = ${stamp}::timestamp
            where id = ${row.id}
              and status = 'offered'
              and version = ${input.expectedVersion}
              and carrier_org_id = ${actor.organizationId}
            returning *
        )
        insert into ${movement} (
            id, organization_id, execution, status,
            client_org_id, client_reference,
            origin, destination, route, cargo_description, category, weight, weight_unit,
            expected_loading_date, expected_delivery_at,
            sell_subtotal, sell_vat, sell_total, sell_currency, sell_fiscal_regime, sell_settlement,
            tracking_enabled, version, created_by, created_at, updated_at
        )
        select
            ${executorId}::text, ${actor.organizationId}::text, 'own-fleet', 'scheduled',
            claimed.organization_id, 'ORD-' || claimed.seq,
            claimed.origin, claimed.destination, claimed.route, claimed.cargo_description,
            claimed.category, claimed.weight, claimed.weight_unit,
            claimed.expected_loading_date, claimed.expected_delivery_at,
            claimed.buy_subtotal, claimed.buy_vat, claimed.buy_total, claimed.buy_currency,
            claimed.buy_fiscal_regime, 'pending'::payment_status_enum,
            true, 1, ${actor.userId}::text, ${stamp}::timestamp, ${stamp}::timestamp
        from claimed
        returning id, seq
    `);

    const created = claimed.rows[0];

    if (!created) throw new TRPCError({ code: "CONFLICT", message: "OFFER_CHANGED" });

    const [updated] = await db.select().from(movement).where(eq(movement.id, row.id)).limit(1);

    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    await recordEvent(db, {
        movementId: row.id,
        kind: "offer",
        actor,
        fromStatus: "offered",
        toStatus: "scheduled",
        note,
        metadata: { action: "accepted" },
    });

    await recordEvent(db, {
        movementId: created.id,
        kind: "status",
        actor,
        toStatus: "scheduled",
        // The client's reference is on the row; this says where it came from
        metadata: { action: "accepted-offer" },
    });

    await notify(db, {
        organizationId: row.organizationId,
        kind: "movement.accepted",
        email: false,
        entityType: "movement",
        entityId: row.id,
        params: { ref, organizationName: executorName, ...common },
    });

    return {
        movement: updated,
        executorMovementId: created.id,
        executorRef: movementRef(Number(created.seq), "own-fleet"),
    };
}

/**
 * Turns a load from one shape into the other: the owner's own truck handed
 * to a partner — the day demand or a contract conflict means it cannot do
 * the job itself — or a partner's load taken back in-house. Same row, same
 * reference number, same trail and costs; only who moves it changes.
 *
 * Only before the truck has left. The rig the owner had named was its own,
 * so it is cleared when a partner takes over; the partner and its price are
 * cleared when the owner takes it back.
 */
export async function convertMovement(
    db: Db,
    actor: MovementActor,
    input: {
        id: string;
        expectedVersion: number;
        to: "partner" | "own-fleet";
        carrierOrgId?: string | null;
        carrierName?: string | null;
    },
): Promise<Movement> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    if (row.execution === input.to) throw new TRPCError({ code: "BAD_REQUEST", message: "ALREADY_THAT_SHAPE" });

    const patch: Partial<typeof movement.$inferInsert> =
        input.to === "partner"
            ? {
                execution: "partner",
                carrierOrgId: input.carrierOrgId ?? null,
                carrierName: input.carrierOrgId ? null : input.carrierName?.trim() || null,
                driverName: null,
                driverPhone: null,
                driverId: null,
                truckPlate: null,
                truckId: null,
                trailerId: null,
                linkId: null,
                conversationId: null,
            }
            : {
                execution: "own-fleet",
                carrierOrgId: null,
                carrierName: null,
                offeredAt: null,
                respondedAt: null,
                responseNote: null,
                buySubtotal: null,
                buyVat: null,
                buyTotal: null,
                buyCurrency: null,
                buyFiscalRegime: null,
                buyInvoiceNumber: null,
                buyInvoiceDate: null,
                buySettlement: null,
                buyPaidAmount: null,
                buySettledAt: null,
            };

    if (input.to === "partner") {
        if (row.status !== "procurement" && row.status !== "scheduled") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
        }

        if (input.carrierOrgId) await assertExecutor(db, actor.organizationId, input.carrierOrgId);
    } else {
        // Back in-house only while nobody else holds it: not offered, not linked
        if ((row.status !== "procurement" && row.status !== "declined") || row.executionMovementId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
        }
    }

    const [updated] = await db
        .update(movement)
        .set({ ...patch, status: "procurement", version: sql`${movement.version} + 1` })
        .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
        .returning();

    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    await recordEvent(db, {
        movementId: row.id,
        kind: "update",
        actor,
        fromStatus: row.status,
        toStatus: "procurement",
        metadata: { action: "converted", to: input.to },
    });

    return updated;
}
