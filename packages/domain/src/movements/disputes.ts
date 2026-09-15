import "server-only";

/**
 * Disputes on portal loads: the rows one covers, opening it, resolving it,
 * and the open one a row is in.
 *
 * A dispute is opened on one row but covers the load in every company's
 * books — the rows linked to it up and down the subcontract chain, pinned at
 * the moment it is opened. Each write is ONE statement: neon-http has no
 * transactions, and a dispute without its rows, or rows still open under a
 * dispute that is over, would hold a load or free it on its own.
 *
 * These doors check the company; whether the member's role may open or
 * resolve (`dispute:open`, `dispute:resolve`) is the caller's check, and so
 * are the trail line and the notifications.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { uniqueViolationConstraint } from "@workspace/db/errors";
import { movement, movementDispute, movementDisputeRow, type MovementDispute } from "@workspace/db/movements";
import type { DisputeReason } from "@workspace/db/types";

import type { MovementActor } from "@workspace/domain/movements/apply";
import { MAX_HOPS, parentMovement } from "@workspace/domain/movements/link";
import { movementRole } from "@workspace/domain/movements/policy";
import { isAskable } from "@workspace/domain/movements/status";

type Db = typeof Database;

/**
 * The rows a dispute opened on this one covers: the row itself first, then
 * the orders it executes above it and the rows executing it below, each walk
 * capped the way every walk in link.ts is.
 */
export async function disputeRowIds(db: Db, movementId: string): Promise<string[]> {
    const ids = [movementId];

    const follow = async (next: (id: string) => Promise<string | null>): Promise<void> => {
        let current = movementId;

        for (let hop = 0; hop < MAX_HOPS; hop++) {
            const id = await next(current);
            // The end of the chain, or a loop that should be impossible
            if (!id || ids.includes(id)) return;
            ids.push(id);
            current = id;
        }

        console.warn(`movement chain from ${movementId} is longer than ${MAX_HOPS} hops; the dispute stops at ${current}`);
    };

    // Up: the order this row is the executor's copy of, and on up
    await follow(async (id) => (await parentMovement(db, id))?.id ?? null);

    // Down: the executor's row, and whoever that executor handed the load to
    await follow(async (id) => {
        const [row] = await db
            .select({ next: movement.executionMovementId })
            .from(movement)
            .where(eq(movement.id, id))
            .limit(1);

        return row?.next ?? null;
    });

    return ids;
}

/**
 * Opens a dispute on a row the company is on — its owner, the executor whose
 * truck it is linked to, or its client — and never on a load that is still
 * only being asked about (DISPUTE_INVALID_LOAD).
 *
 * The dispute, the companies it is announced to and its covered rows are one
 * statement. A dispute only holds the rows that are free: the row it is opened
 * on is claimed outright, so a second open dispute on it fails the partial
 * unique index and nothing is written (DISPUTE_EXISTS) — including when two
 * companies on one chain open at the same moment — while the rest of the chain
 * is claimed only where no dispute holds it already. A load handed back after
 * a dispute can still be disputed by the next carrier on its own row, and the
 * earlier dispute keeps the rows it already held.
 *
 * `party_org_ids` pins every company on the chain as it stands right now, so
 * the news of this dispute never reaches a carrier that arrives later and is
 * not allowed to read it (procedures.ts `announceDispute`).
 */
export async function openDispute(
    db: Db,
    actor: MovementActor,
    input: { movementId: string; reason: DisputeReason; description: string },
): Promise<{ dispute: MovementDispute; rowIds: string[] }> {
    const [row] = await db.select().from(movement).where(eq(movement.id, input.movementId)).limit(1);

    // Never a 403: telling a stranger a load exists is already telling them something
    if (!row || !movementRole(row, actor.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    if (isAskable(row.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_INVALID_LOAD" });
    }

    const id = crypto.randomUUID();
    const rowIds = await disputeRowIds(db, row.id);
    const covered = sql.identifier("covered");
    const party = sql.identifier("party");
    const held = sql.identifier("held");

    let pinned: { rows: { movement_id: string }[] };

    // `parties` spells the three movement roles the way policy.ts spells
    // them, a carrier counting only while it is actually involved in the row
    try {
        pinned = await db.execute<{ movement_id: string }>(sql`
            with ${covered} as (
                select ${movement}.* from ${movement}
                where ${movement}.id in ${rowIds}
                  and (${movement}.id = ${row.id} or not exists (
                    select 1 from ${movementDisputeRow} as ${held}
                    where ${held}.movement_id = ${movement}.id and ${held}.open
                  ))
            ),
            parties as (
                select distinct ${party}.org_id
                from ${covered}
                cross join lateral (values
                    (${covered}.organization_id),
                    (${covered}.client_org_id),
                    (case when ${covered}.status in ('offered', 'declined') or ${covered}.execution_movement_id is not null
                        then ${covered}.carrier_org_id end)
                ) as ${party}(org_id)
                where ${party}.org_id is not null
            ),
            dispute as (
                insert into ${movementDispute} (id, movement_id, opened_by_org_id, opened_by, reason, description, party_org_ids)
                select ${id}, ${row.id}, ${actor.organizationId}, ${actor.userId}, ${input.reason}, ${input.description.trim()},
                    coalesce((select array_agg(org_id) from parties), '{}'::text[])
                returning id
            ),
            opened as (
                insert into ${movementDisputeRow} (dispute_id, movement_id)
                select dispute.id, ${row.id} from dispute
                returning movement_id
            ),
            rest as (
                insert into ${movementDisputeRow} (dispute_id, movement_id)
                select dispute.id, ${covered}.id
                from dispute cross join ${covered}
                where ${covered}.id <> ${row.id}
                returning movement_id
            )
            select movement_id from opened
            union all
            select movement_id from rest
        `);
    } catch (error) {
        if (uniqueViolationConstraint(error) !== null) {
            throw new TRPCError({ code: "CONFLICT", message: "DISPUTE_EXISTS" });
        }
        throw error;
    }

    const [dispute] = await db.select().from(movementDispute).where(eq(movementDispute.id, id)).limit(1);

    if (!dispute) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    return { dispute, rowIds: pinned.rows.map((pin) => pin.movement_id) };
}

/**
 * Resolves an open dispute with the note that says how. Only the company that
 * opened it can. The dispute and every row it covers are released in one
 * statement, so no row stays held by a dispute that is over. Somebody else's
 * dispute, one already resolved and an id that does not exist all read as
 * NOT_FOUND.
 */
export async function resolveDispute(
    db: Db,
    actor: MovementActor,
    input: { id: string; resolution: string },
): Promise<{ dispute: MovementDispute; rowIds: string[] }> {
    // Naive UTC, the way drizzle writes every timestamp column in this repo
    const stamp = new Date().toISOString();

    const released = await db.execute<{ movement_id: string }>(sql`
        with resolved as (
            update ${movementDispute}
            set status = 'resolved',
                resolution = ${input.resolution.trim()},
                resolved_by = ${actor.userId},
                resolved_at = ${stamp}::timestamp,
                updated_at = ${stamp}::timestamp
            where id = ${input.id}
              and status = 'open'
              and opened_by_org_id = ${actor.organizationId}
            returning id
        )
        update ${movementDisputeRow}
        set open = false
        where dispute_id in (select id from resolved)
        returning movement_id
    `);

    // Every dispute covers at least the row it was opened on
    if (released.rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    const [dispute] = await db.select().from(movementDispute).where(eq(movementDispute.id, input.id)).limit(1);

    if (!dispute) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    return { dispute, rowIds: released.rows.map((pin) => pin.movement_id) };
}

/** The open dispute a row is covered by, if any — what keeps it from being closed. */
export async function activeDisputeFor(db: Db, movementId: string): Promise<MovementDispute | null> {
    const [row] = await db
        .select({ dispute: movementDispute })
        .from(movementDisputeRow)
        .innerJoin(movementDispute, eq(movementDispute.id, movementDisputeRow.disputeId))
        .where(and(eq(movementDisputeRow.movementId, movementId), eq(movementDisputeRow.open, true)))
        .limit(1);

    return row?.dispute ?? null;
}
