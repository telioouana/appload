import "server-only";

/**
 * A load's quote round: the owner asking several connected transporters at
 * once what they would move it for, each of them answering with a price or
 * a no, and the owner awarding one.
 *
 * Kept apart from offer.ts the way offer.ts is kept apart from the status
 * door: an offer puts one company's terms in front of one partner, a round
 * puts a load in front of several and collects their terms. The two meet at
 * the award — the quote is copied into the row's buy leg and the load goes
 * through the offer door as it always did, so the transporter's yes is
 * written by the one function that knows how to write it (respondToOffer).
 *
 * What a transporter answers is between it and the owner: no trail line is
 * written for a quote or a refusal, since the trail of a load being asked
 * about is read by every transporter asked (projection.ts eventKindsFor),
 * and one of them must not learn who else quoted. The request rows are the
 * record; the owner reads them all, a transporter only its own.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movement, movementRequest, type Movement, type MovementRequest } from "@workspace/db/movements";
import { isApploadOrg } from "@workspace/db/types";

import { recordEvent, statusStamps, type MovementActor } from "@workspace/domain/movements/apply";
import { organization } from "@workspace/db/users";

import { assertAskable, ensureConnection, LIVE_REQUEST_STATUSES, organizationName } from "@workspace/domain/movements/link";
import { FOLLOWS_APPLOAD_ORDER } from "@workspace/domain/movements/mirror";
import { loadOwn, offerMovement } from "@workspace/domain/movements/offer";
import { counterpartyRef, movementRef } from "@workspace/domain/movements/refs";
import { notify } from "@workspace/domain/notifications";
import { place } from "@workspace/domain/tracking/slot";

type Db = typeof Database;

/** How many transporters one round may go out to at once — the same ceiling Appload's RFQ keeps. */
export const MAX_REQUEST_CARRIERS = 25;

/** A transporter's price, in the shape the row's buy leg takes. */
export type QuoteLeg = {
    subtotal?: number;
    vat?: number;
    total: number;
    currency: NonNullable<Movement["buyCurrency"]>;
    fiscalRegime?: NonNullable<Movement["buyFiscalRegime"]>;
};

/** Statuses a request may be reopened from: nobody is waiting on them any more. */
const REOPENABLE: readonly MovementRequest["status"][] = ["withdrawn", "declined", "closed"];

const decimal = (value: number | undefined | null): string | null =>
    value === undefined || value === null ? null : String(Math.round(value * 100) / 100);

const bump = { version: sql`${movement.version} + 1` };

function assertRoundOpenable(row: Movement): void {
    if (row.orderId !== null) throw new TRPCError({ code: "BAD_REQUEST", message: FOLLOWS_APPLOAD_ORDER });

    if (row.execution !== "partner" || row.executionMovementId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    if (row.status !== "procurement" && row.status !== "prospect" && row.status !== "declined") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }
}

/**
 * Puts the load in front of the transporters named, and marks it a prospect
 * if it was not one yet. A transporter already waiting on it is left alone —
 * asking again would reset an answer it gave; one that was withdrawn,
 * declined or closed out is asked afresh. Every id has to be a transporter on
 * the portal — connected or not: asking is an invitation, and the award
 * makes the two partners. An off-portal one has nobody to read the request,
 * and Appload keeps the offer door (appload/link.ts).
 */
export async function sendMovementRequests(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number; carrierOrgIds: string[]; message?: string | null },
): Promise<{ movement: Movement; sent: string[]; skipped: string[] }> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    assertRoundOpenable(row);

    const wanted = [...new Set(input.carrierOrgIds)];

    if (wanted.length === 0 || wanted.length > MAX_REQUEST_CARRIERS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NO_CARRIERS_TO_ASK" });
    }

    for (const carrierOrgId of wanted) {
        if (isApploadOrg(carrierOrgId)) throw new TRPCError({ code: "BAD_REQUEST", message: "APPLOAD_NOT_A_CANDIDATE" });
        if (carrierOrgId === actor.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_A_CARRIER" });

        await assertAskable(db, carrierOrgId);
    }

    const message = input.message?.trim() || null;

    const existing = await db
        .select({ id: movementRequest.id, carrierOrgId: movementRequest.carrierOrgId, status: movementRequest.status })
        .from(movementRequest)
        .where(and(eq(movementRequest.movementId, row.id), inArray(movementRequest.carrierOrgId, wanted)));

    const known = new Set(existing.map((entry) => entry.carrierOrgId));
    const fresh = wanted.filter((carrierOrgId) => !known.has(carrierOrgId));
    const reopen = existing.filter((entry) => REOPENABLE.includes(entry.status));
    const skipped = existing.filter((entry) => !REOPENABLE.includes(entry.status)).map((entry) => entry.carrierOrgId);

    if (fresh.length > 0) {
        await db.insert(movementRequest).values(fresh.map((carrierOrgId) => ({
            movementId: row.id,
            carrierOrgId,
            message,
            createdBy: actor.userId,
        })));
    }

    if (reopen.length > 0) {
        await db
            .update(movementRequest)
            .set({
                status: "requested",
                message,
                note: null,
                quoteSubtotal: null,
                quoteVat: null,
                quoteTotal: null,
                quoteCurrency: null,
                quoteFiscalRegime: null,
                respondedAt: null,
                createdBy: actor.userId,
            })
            .where(inArray(movementRequest.id, reopen.map((entry) => entry.id)));
    }

    const sent = [...fresh, ...reopen.map((entry) => entry.carrierOrgId)];

    let updated = row;

    // The round opens on the row: from here on it is being asked about, and
    // the status door treats it like an offer in front of a partner
    if (row.status !== "prospect") {
        const now = new Date();
        const [moved] = await db
            .update(movement)
            .set({ status: "prospect", ...statusStamps(row, "prospect", now), ...bump })
            .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
            .returning();

        if (!moved) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

        updated = moved;
    }

    if (sent.length > 0) {
        await recordEvent(db, {
            movementId: row.id,
            kind: "offer",
            actor,
            fromStatus: row.status,
            toStatus: "prospect",
            note: message,
            metadata: { action: "requested", count: sent.length },
        });

        const ownerName = await organizationName(db, actor.organizationId);
        const params = {
            // The transporter is asked about the load, not told the name the
            // owner's own client gave it
            ref: counterpartyRef(row),
            organizationName: ownerName,
            origin: place(row.origin),
            destination: place(row.destination),
        };

        for (const carrierOrgId of sent) {
            await notify(db, {
                organizationId: carrierOrgId,
                kind: "movement.requested",
                email: true,
                entityType: "movement",
                entityId: row.id,
                params,
            });
        }
    }

    return { movement: updated, sent, skipped };
}

/** The transporter's own live request on a load, or a 404: a stranger is told nothing. */
async function loadLiveRequest(db: Db, movementId: string, carrierOrgId: string): Promise<MovementRequest> {
    const [request] = await db
        .select()
        .from(movementRequest)
        .where(and(
            eq(movementRequest.movementId, movementId),
            eq(movementRequest.carrierOrgId, carrierOrgId),
            inArray(movementRequest.status, [...LIVE_REQUEST_STATUSES]),
        ))
        .limit(1);

    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    return request;
}

/** The transporter names its price. A second quote replaces the first. */
export async function quoteMovementRequest(
    db: Db,
    actor: MovementActor,
    input: { id: string; quote: QuoteLeg; note?: string | null },
): Promise<MovementRequest> {
    const request = await loadLiveRequest(db, input.id, actor.organizationId);

    const [updated] = await db
        .update(movementRequest)
        .set({
            status: "quoted",
            quoteSubtotal: decimal(input.quote.subtotal),
            quoteVat: decimal(input.quote.vat),
            quoteTotal: decimal(input.quote.total),
            quoteCurrency: input.quote.currency,
            quoteFiscalRegime: input.quote.fiscalRegime ?? null,
            note: input.note?.trim() || null,
            respondedAt: new Date(),
        })
        .where(eq(movementRequest.id, request.id))
        .returning();

    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    const [row] = await db.select().from(movement).where(eq(movement.id, request.movementId)).limit(1);

    if (row) {
        await notify(db, {
            organizationId: row.organizationId,
            kind: "movement.quoted",
            email: true,
            entityType: "movement",
            entityId: row.id,
            params: {
                ref: movementRef(row),
                organizationName: await organizationName(db, actor.organizationId),
                total: input.quote.total,
                currency: input.quote.currency,
            },
        });
    }

    return updated;
}

/** The transporter passes on the load. */
export async function declineMovementRequest(
    db: Db,
    actor: MovementActor,
    input: { id: string; note?: string | null },
): Promise<MovementRequest> {
    const request = await loadLiveRequest(db, input.id, actor.organizationId);

    const [updated] = await db
        .update(movementRequest)
        .set({ status: "declined", note: input.note?.trim() || null, respondedAt: new Date() })
        .where(eq(movementRequest.id, request.id))
        .returning();

    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

    const [row] = await db.select().from(movement).where(eq(movement.id, request.movementId)).limit(1);

    if (row) {
        await notify(db, {
            organizationId: row.organizationId,
            kind: "movement.declined",
            email: true,
            entityType: "movement",
            entityId: row.id,
            params: {
                ref: movementRef(row),
                organizationName: await organizationName(db, actor.organizationId),
                origin: place(row.origin),
                destination: place(row.destination),
            },
        });
    }

    return updated;
}

/** Tells the transporters named that the owner stopped waiting on them, and closes their rows. */
async function closeRows(
    db: Db,
    row: Movement,
    carrierOrgIds: string[],
    status: "withdrawn" | "closed",
): Promise<void> {
    if (carrierOrgIds.length === 0) return;

    await db
        .update(movementRequest)
        .set({ status })
        .where(and(
            eq(movementRequest.movementId, row.id),
            inArray(movementRequest.carrierOrgId, carrierOrgIds),
            inArray(movementRequest.status, [...LIVE_REQUEST_STATUSES]),
        ));

    const ownerName = await organizationName(db, row.organizationId);

    for (const carrierOrgId of carrierOrgIds) {
        await notify(db, {
            organizationId: carrierOrgId,
            kind: "movement.withdrawn",
            email: false,
            entityType: "movement",
            entityId: row.id,
            params: {
                ref: counterpartyRef(row),
                organizationName: ownerName,
                origin: place(row.origin),
                destination: place(row.destination),
            },
        });
    }
}

/** The owner stops waiting on one transporter. Its quote, if it gave one, stays on the row as history. */
export async function withdrawMovementRequest(
    db: Db,
    actor: MovementActor,
    input: { id: string; carrierOrgId: string },
): Promise<void> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(eq(movement.id, input.id), eq(movement.organizationId, actor.organizationId)))
        .limit(1);

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    await closeRows(db, row, [input.carrierOrgId], "withdrawn");
}

/**
 * The round is over: the load was awarded, taken back to the draft, called
 * off or taken in-house. Every transporter still waiting is told, except the
 * one the load went to.
 */
export async function closeMovementRequests(db: Db, row: Movement, opts: { exceptOrgId?: string } = {}): Promise<void> {
    const live = await db
        .select({ carrierOrgId: movementRequest.carrierOrgId })
        .from(movementRequest)
        .where(and(eq(movementRequest.movementId, row.id), inArray(movementRequest.status, [...LIVE_REQUEST_STATUSES])));

    await closeRows(
        db,
        row,
        live.map((entry) => entry.carrierOrgId).filter((id) => id !== opts.exceptOrgId),
        "closed",
    );
}

/**
 * The owner picks a quote. The transporter and its price go on the row, the
 * other transporters are told the round is over, and the load is placed with
 * the winner through the offer door at the price it named — its yes is one
 * click, and what that click writes (its own trip, its own driver) is
 * exactly what an accepted offer always wrote.
 */
export async function awardMovementRequest(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number; carrierOrgId: string; message?: string | null },
): Promise<Movement> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    if (row.orderId !== null) throw new TRPCError({ code: "BAD_REQUEST", message: FOLLOWS_APPLOAD_ORDER });

    if (row.execution !== "partner" || row.executionMovementId || row.status !== "prospect") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    const [request] = await db
        .select()
        .from(movementRequest)
        .where(and(
            eq(movementRequest.movementId, row.id),
            eq(movementRequest.carrierOrgId, input.carrierOrgId),
            eq(movementRequest.status, "quoted"),
        ))
        .limit(1);

    if (!request?.quoteTotal || !request.quoteCurrency) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NOT_QUOTED" });
    }

    // Back to the draft with the winner and its price on the row: the one
    // state the offer door places a load from
    const [staged] = await db
        .update(movement)
        .set({
            status: "procurement",
            carrierOrgId: request.carrierOrgId,
            carrierName: null,
            buySubtotal: request.quoteSubtotal,
            buyVat: request.quoteVat,
            buyTotal: request.quoteTotal,
            buyCurrency: request.quoteCurrency,
            buyFiscalRegime: request.quoteFiscalRegime,
            buySettlement: "pending",
            ...bump,
        })
        .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
        .returning();

    if (!staged) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    await db.update(movementRequest).set({ status: "awarded" }).where(eq(movementRequest.id, request.id));

    await recordEvent(db, {
        movementId: row.id,
        kind: "offer",
        actor,
        fromStatus: "prospect",
        toStatus: "procurement",
        metadata: { action: "awarded" },
    });

    await closeMovementRequests(db, staged, { exceptOrgId: request.carrierOrgId });

    // A transporter asked from beyond the company's partners becomes one
    // now: the offer door and the transporter's own yes both insist on it
    const [owner] = await db
        .select({ type: organization.type, name: organization.name })
        .from(organization)
        .where(eq(organization.id, actor.organizationId))
        .limit(1);

    const connection = await ensureConnection(db, actor.organizationId, request.carrierOrgId, owner?.type === "carrier" ? "carrier" : "shipper");

    if (connection.created) {
        await notify(db, {
            organizationId: request.carrierOrgId,
            kind: "connection.accepted",
            email: false,
            entityType: "connection",
            entityId: connection.id,
            params: { partnerName: owner?.name ?? "" },
        });
    }

    return offerMovement(db, actor, { id: row.id, expectedVersion: staged.version, message: input.message });
}
