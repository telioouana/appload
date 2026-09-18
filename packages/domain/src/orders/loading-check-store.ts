import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
    order,
    orderDispatch,
    orderDocument,
    orderHistory,
    orderLoadingCheck,
    type Order,
    type OrderLoadingCheck,
} from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";

import type { Actor } from "@workspace/domain/orders/actor";
import { deriveOutcome, type LoadingCheckInput, type LoadingCheckState } from "@workspace/domain/orders/loading-check";

type Db = typeof Database;

/** The pack a check hangs off: the order's open dispatch, if it has one. */
export async function openDispatchId(db: Db, orderPk: string): Promise<string | null> {
    const [row] = await db
        .select({ id: orderDispatch.id })
        .from(orderDispatch)
        .where(and(eq(orderDispatch.orderId, orderPk), isNull(orderDispatch.supersededAt)))
        .limit(1);

    return row?.id ?? null;
}

/**
 * What the order's check says, read against the pack currently in force: a
 * re-dispatch is a new truck, so the check of the previous one says nothing
 * about it. An order with no pack at all (dispatched before packs existed,
 * or a pack write that failed) falls back to its latest check.
 */
export async function loadLoadingCheckState(
    db: Db,
    orderPk: string,
    dispatchId: string | null,
): Promise<LoadingCheckState> {
    const [check] = await db
        .select()
        .from(orderLoadingCheck)
        .where(dispatchId === null
            ? eq(orderLoadingCheck.orderId, orderPk)
            : and(eq(orderLoadingCheck.orderId, orderPk), eq(orderLoadingCheck.dispatchId, dispatchId)))
        .orderBy(desc(orderLoadingCheck.checkedAt))
        .limit(1);

    if (!check) {
        return { state: "none", check: null };
    }

    return { state: check.outcome === "skipped" ? "partial" : check.outcome, check };
}

/**
 * Records one check. Whoever ran it is on the row — Appload ops (no org) or
 * the shipper that ordered the load — and a mismatch flags the order for
 * review, which is what makes the next move a supervisory decision.
 *
 * Every submission is pinned to the version the checker's page was showing,
 * and the order is written first: a check signed off against a stale page
 * (a re-dispatch since, another truck at the gate) is refused outright
 * rather than recorded against a pack nobody looked at, and a mismatch can
 * never leave a check that blocks the carrier behind a flag that was never
 * written. There are no transactions here, so what a conflict costs is a
 * re-submission on a refreshed page.
 */
export async function recordLoadingCheck(
    db: Db,
    params: { current: Order; actor: Actor; input: LoadingCheckInput },
): Promise<{ check: OrderLoadingCheck; order: Order }> {
    const { current, actor, input } = params;

    const photoIds = [...new Set(input.photoDocumentIds)];

    // The photos are order documents the caller filed through the ordinary
    // upload door; ids from another order (or of another type) are refused
    // rather than stored as this load's evidence
    if (photoIds.length > 0) {
        const rows = await db
            .select({ id: orderDocument.id })
            .from(orderDocument)
            .where(and(
                eq(orderDocument.orderId, current.id),
                inArray(orderDocument.id, photoIds),
                eq(orderDocument.type, "loading-photo"),
                isNull(orderDocument.deletedAt),
            ));

        if (rows.length !== photoIds.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "PHOTO_NOT_ON_ORDER" });
        }
    }

    const outcome = deriveOutcome(input.items);
    const dispatchId = await openDispatchId(db, current.id);

    // Same encoding as `gateFlagReason`: the code, what failed, and the
    // checker's own words after the dash
    const failed = input.items.filter((item) => item.ok === false).map((item) => item.key).join(", ");
    const trimmed = input.note?.trim();
    const reason = `LOADING_MISMATCH${failed ? `: ${failed}` : ""}${trimmed ? ` — ${trimmed}` : ""}`;

    const [updated] = await db
        .update(order)
        .set({
            ...(outcome === "mismatch" && {
                flaggedForReview: true,
                flagReason: reason,
                flaggedAt: new Date(),
                flaggedBy: actor.userId,
            }),
            version: sql`${order.version} + 1`,
        })
        .where(and(eq(order.id, current.id), eq(order.version, input.expectedVersion)))
        .returning();

    if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
    }

    const [check] = await db
        .insert(orderLoadingCheck)
        .values({
            orderId: current.id,
            dispatchId,
            items: input.items,
            outcome,
            photoDocumentIds: photoIds,
            note: input.note ?? null,
            checkedBy: actor.userId,
            checkedByOrgId: actor.kind === "tenant" ? actor.organizationId : null,
        })
        .returning();

    if (!check) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CHECK_NOT_RECORDED" });
    }

    await db.insert(orderHistory).values({
        orderId: current.id,
        actorUserId: actor.userId,
        kind: "check",
        metadata: {
            checkId: check.id,
            outcome,
            items: input.items,
            // The column holds one reason at a time, so what a mismatch
            // replaced is kept here
            ...(current.flagReason && { previousFlagReason: current.flagReason }),
        },
    });

    return { check, order: updated };
}
