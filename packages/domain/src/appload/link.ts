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
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movement, movementRoute, type Movement } from "@workspace/db/movements";
import { order, orderDispatch, type Order } from "@workspace/db/orders";
import { APPLOAD_ORG_ID, APPLOAD_ORG_NAME, isPartnerOrgType, type OrderStatus } from "@workspace/db/types";
import { organization } from "@workspace/db/users";

import { recordEvent, statusStamps, type MovementActor } from "@workspace/domain/movements/apply";
import { ensureOrderReference, nextReference } from "@workspace/domain/movements/counters";
import { isOnPortal } from "@workspace/domain/movements/link";
import { FOLLOWS_APPLOAD_ORDER, mirrorStatus } from "@workspace/domain/movements/mirror";
import { loadOwn } from "@workspace/domain/movements/offer";
import { needsOrderReference } from "@workspace/domain/movements/refs";
import { createOrder } from "@workspace/domain/orders/create";
import { openDispatchId } from "@workspace/domain/orders/loading-check-store";
import { portalNextOrderId } from "@workspace/domain/orders/next-order-id";
import { CreateOrderSchemaServer } from "@workspace/domain/orders/schemas";
import { assertTrackingAllowance } from "@workspace/domain/subscription";

type Db = typeof Database;

/**
 * A load Appload is asked to move has to say what is being moved and when:
 * the order row demands all four columns, and a company cannot be told
 * afterwards that its request was filed with a guess in it.
 */
export const APPLOAD_NEEDS_DETAILS = "APPLOAD_NEEDS_DETAILS";

/** The columns `offerToAppload` cannot invent. */
const REQUIRED_DETAILS = ["expectedLoadingDate", "category", "cargoDescription", "weight"] as const;

/** The trail note a candidate row carries when somebody else won the order. */
const BOOKED_ELSEWHERE = "APPLOAD_BOOKED_ELSEWHERE";

/** …and when the client stopped waiting for this one's answer. */
const REQUEST_WITHDRAWN = "APPLOAD_REQUEST_WITHDRAWN";

/** What every row this module writes puts on its trail. */
const systemEvent = (
    db: Db,
    row: { id: string; status: Movement["status"] },
    facts: OrderFacts,
    to: Movement["status"],
    note?: string | null,
) => recordEvent(db, {
    movementId: row.id,
    kind: "system",
    actor: null,
    fromStatus: row.status,
    toStatus: to,
    note: note ?? null,
    metadata: { orderId: facts.orderId, orderStatus: facts.status },
});

/** The two things a linked row's trail says about the order it follows. */
type OrderFacts = { id: string; orderId: string; status: string };

const factsOf = (row: Order): OrderFacts => ({ id: row.id, orderId: row.orderId, status: row.status });

async function loadFacts(db: Db, orderPk: string): Promise<OrderFacts | null> {
    const [row] = await db
        .select({ id: order.id, orderId: order.orderId, status: order.status })
        .from(order)
        .where(eq(order.id, orderPk))
        .limit(1);

    return row ?? null;
}

/**
 * Whether a patch says anything the row does not already hold. The sync runs
 * on every order write, most of which change nothing down here — and a write
 * that changes nothing still bumps the row's version out from under whoever
 * has it open, and still lands a line on its trail.
 */
const differs = (row: Movement, patch: Record<string, unknown>): boolean =>
    Object.entries(patch).some(([key, value]) => (row as Record<string, unknown>)[key] !== value);

/** This company's live row on this order, or none. */
async function liveRow(db: Db, orderPk: string, organizationId: string): Promise<Movement | null> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(
            eq(movement.orderId, orderPk),
            eq(movement.organizationId, organizationId),
            ne(movement.status, "cancelled"),
        ))
        .limit(1);

    return row ?? null;
}

/** The route and cargo a linked row is opened with: the order's, copied. */
const cargoOf = (row: Order) => ({
    origin: row.loadingAddress,
    destination: row.offloadingAddress,
    route: row.route,
    cargoDescription: row.description,
    category: row.category,
    weight: row.weight,
    weightUnit: row.weightUnit,
    expectedLoadingDate: row.expectedLoadingDate,
    expectedDeliveryAt: row.expectedOffloadingDate,
});

/**
 * What the company that handed the load over pays Appload — its buy leg — and
 * what Appload pays the company moving it, which is that company's sell leg.
 * Copied only once the order carries a priced leg — amount and currency, the
 * pair the row's own CHECK demands: a prospect has neither, and writing a null
 * over what the row already holds would erase it.
 */
const buyLeg = (row: Order) => (row.shipperTotal === null || row.shipperCurrency === null ? {} : {
    buySubtotal: row.shipperSubtotal,
    buyVat: row.shipperVAT,
    buyTotal: row.shipperTotal,
    buyCurrency: row.shipperCurrency,
});

const sellLeg = (row: Order) => (row.carrierTotal === null || row.carrierCurrency === null ? {} : {
    sellSubtotal: row.carrierSubtotal,
    sellVat: row.carrierVAT,
    sellTotal: row.carrierTotal,
    sellCurrency: row.carrierCurrency,
    sellFiscalRegime: row.fiscalRegime,
});

/**
 * The driver and the rig the order was dispatched with. The plates are on the
 * order row; the fleet ids are the pack's, which is the only place the truck,
 * trailer and link the papers were checked against are named.
 */
async function dispatchColumns(db: Db, row: Order) {
    const dispatchId = await openDispatchId(db, row.id);

    const [pack] = dispatchId
        ? await db.select().from(orderDispatch).where(eq(orderDispatch.id, dispatchId)).limit(1)
        : [];

    return {
        driverName: row.driverName,
        driverPhone: row.driverPhoneNumber,
        driverId: row.driverId,
        truckPlate: row.truckPlate,
        ...(pack && { truckId: pack.truckId, trailerId: pack.trailerId, linkId: pack.linkId }),
    };
}

/**
 * Hands a load to Appload: creates the brokerage order behind the tenant's
 * own row and puts the row on it. The tenant keeps its load, its reference
 * and its books; what it gains is Appload's progress, tracking and chat.
 */
export async function offerToAppload(
    db: Db,
    actor: MovementActor,
    input: { id: string; expectedVersion: number; message?: string | null },
): Promise<Movement> {
    const row = await loadOwn(db, actor, input.id, input.expectedVersion);

    if (row.orderId !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: FOLLOWS_APPLOAD_ORDER });
    }

    if (row.execution !== "partner" || row.carrierOrgId !== APPLOAD_ORG_ID || row.executionMovementId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    if (row.status !== "procurement" && row.status !== "declined") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
    }

    // The order row demands all four; the dialog names them back from the cause
    const missing = REQUIRED_DETAILS.filter((field) => row[field] === null);

    if (missing.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: APPLOAD_NEEDS_DETAILS, cause: missing });
    }

    // Handing the load over commits the company to a tracked movement, the
    // same thing placing it with any other partner buys
    await assertTrackingAllowance(db, actor.organizationId);

    const [org] = await db
        .select({ name: organization.name, type: organization.type })
        .from(organization)
        .where(eq(organization.id, actor.organizationId))
        .limit(1);

    if (!org || !isPartnerOrgType(org.type)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_PARTNER_ACCOUNT" });
    }

    // The leg Google already measured for this load's map, in kilometres; an
    // order needs the column and nobody has typed one
    const [route] = await db
        .select({ distanceMeters: movementRoute.distanceMeters })
        .from(movementRoute)
        .where(eq(movementRoute.movementId, row.id))
        .limit(1);

    const payload = CreateOrderSchemaServer.parse({
        shipperId: actor.organizationId,
        shipperName: org.name,
        status: "prospect",
        offers: [],
        loadingAddress: row.origin,
        expectedLoadingDate: row.expectedLoadingDate,
        offloadingAddress: row.destination,
        expectedOffloadingDate: row.expectedDeliveryAt ?? undefined,
        distance: route?.distanceMeters ? Math.round(route.distanceMeters / 1000) : 0,
        deliveries: 1,
        routeType: row.route,
        tripType: "normal",
        category: row.category,
        description: row.cargoDescription,
        weight: Number(row.weight),
        weightUnit: row.weightUnit ?? "ton",
        loadType: "dedicated",
        shipperCurrency: row.buyCurrency ?? row.sellCurrency ?? "MZN",
    });

    const created = await createOrder(
        {
            db,
            actor: {
                kind: "tenant",
                userId: actor.userId,
                organizationId: actor.organizationId,
                orgType: org.type,
            },
            sheets: "defer",
        },
        payload,
        // The tenant's row is put on the order below, by this door: a mirror
        // pass inside the create would open a second one for the same company
        { nextOrderId: portalNextOrderId(db), syncLinks: false },
    );

    // Where the order came from, the column the create payload does not carry.
    // Never fatal: the order exists either way, and the load must still be put
    // on it
    await db
        .update(order)
        .set({ source: org.type === "shipper" ? "client" : "carrier" })
        .where(eq(order.id, created.order.id))
        .catch((error: unknown) => console.error(`order source failed for ${created.orderId}`, error));

    const now = new Date();

    const [updated] = await db
        .update(movement)
        .set({
            status: "offered",
            offeredAt: now,
            orderId: created.order.id,
            // A second hand-over after a decline starts clean
            respondedAt: null,
            responseNote: null,
            version: sql`${movement.version} + 1`,
        })
        .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
        .returning();

    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

    await recordEvent(db, {
        movementId: row.id,
        kind: "offer",
        actor,
        fromStatus: row.status,
        toStatus: "offered",
        note: input.message,
        metadata: { action: "offered", apploadOrderId: created.orderId },
    });

    return updated;
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
    db: Db,
    params: { order: Order; from: OrderStatus | null; dispatch?: boolean; candidates?: "settle" },
): Promise<void> {
    const row = params.order;

    await syncOrderer(db, row);

    // Nobody is moving this any more — the order was called off, or its
    // booking taken back — so every row on the executing side goes. Booking
    // again opens a fresh one, with a number of its own
    const released = row.status === "cancelled"
        || row.status === "underbid"
        || (params.from === "booked" && row.status === "prospect");

    if (released) {
        // A cancelled order takes every row on the executing side with it; an
        // un-book releases only the carrier that was booked — the carriers
        // still waiting to hear keep the request the client sent them
        const ended = row.status === "cancelled" || row.status === "underbid";

        if (ended) {
            await cancelLinkedRows(db, factsOf(row), {});
        } else if (row.carrierId) {
            await cancelLinkedRows(db, factsOf(row), { orgId: row.carrierId });
        }
    } else {
        await syncExecutor(db, row, params.dispatch === true);
    }

    if (params.candidates === "settle") {
        await closeApploadCandidates(db, { orderPk: row.id, exceptOrgId: row.carrierId ?? undefined });
    }
}

/**
 * The row of the company that handed the load over. It exists already when
 * that company filed it through the portal; it is opened here when Appload
 * took the order for a client that is on the portal.
 */
async function syncOrderer(db: Db, row: Order): Promise<void> {
    const now = new Date();
    const facts = factsOf(row);

    // This company's live row on the order, and the rows of any company that
    // used to be its shipper: the deal form lets ops correct the shipper of a
    // quote, and the one that was replaced is no longer party to this order
    const rows = await db
        .select()
        .from(movement)
        .where(and(
            eq(movement.orderId, row.id),
            ne(movement.status, "cancelled"),
            or(
                eq(movement.organizationId, row.shipperId),
                and(eq(movement.execution, "partner"), eq(movement.carrierOrgId, APPLOAD_ORG_ID)),
            ),
        ));

    for (const stale of rows) {
        if (stale.organizationId === row.shipperId) continue;

        // Handed back the way a cancel hands it back: its own again while
        // nobody had committed, cancelled once somebody had
        const target = mirrorStatus("cancelled", "orderer", stale.status);

        if (!target) continue;

        const [released] = await db
            .update(movement)
            .set({
                status: target.status,
                ...statusStamps(stale, target.status, now),
                ...(target.unlink && { orderId: null }),
                version: sql`${movement.version} + 1`,
            })
            .where(and(eq(movement.id, stale.id), eq(movement.status, stale.status)))
            .returning({ id: movement.id });

        if (released) await systemEvent(db, stale, facts, target.status);
    }

    if (!(await isOnPortal(db, row.shipperId))) return;

    const existing = rows.find((candidate) => candidate.organizationId === row.shipperId) ?? null;

    if (!existing) {
        const target = mirrorStatus(row.status, "orderer", "offered");

        // A finished, cancelled or abandoned order opens nothing
        if (!target || target.unlink || target.status === "cancelled") return;

        const [created] = await db
            .insert(movement)
            .values({
                organizationId: row.shipperId,
                orderId: row.id,
                execution: "partner",
                status: target.status,
                carrierOrgId: APPLOAD_ORG_ID,
                // The load was filed as a request; it keeps that name as
                // history and takes its own ORD once it is committed to
                requestReference: await nextReference(db, row.shipperId, "REQ", row.createdAt),
                reference: needsOrderReference(target.status)
                    ? await nextReference(db, row.shipperId, "ORD", row.createdAt)
                    : null,
                ...cargoOf(row),
                ...buyLeg(row),
                ...statusStamps(null, target.status, now),
                // The order side pings the driver and is billed for it
                trackingEnabled: false,
            })
            .returning();

        if (created) await systemEvent(db, { id: created.id, status: created.status }, facts, created.status);

        return;
    }

    const target = mirrorStatus(row.status, "orderer", existing.status);
    const moves = target !== null
        && (target.status !== existing.status || (target.unlink && existing.orderId !== null));

    // Somebody has committed to the load, so it is an order in the tenant's
    // own books and needs its number before anything else is written about it
    if (target && needsOrderReference(target.status) && existing.reference === null) {
        await ensureOrderReference(db, existing);
    }

    const patch = {
        ...(moves && target && {
            status: target.status,
            ...statusStamps(existing, target.status, now),
            ...(target.unlink && { orderId: null }),
        }),
        ...buyLeg(row),
    };

    if (!moves && !differs(existing, patch)) return;

    const [updated] = await db
        .update(movement)
        .set({ ...patch, version: sql`${movement.version} + 1` })
        .where(and(eq(movement.id, existing.id), eq(movement.status, existing.status)))
        .returning();

    // The row moved between the read and the write; the next pass repairs it
    if (!updated) return;

    await systemEvent(db, existing, facts, updated.status);
}

/**
 * The row of the company moving the load. On a booking it is the candidate
 * that won, promoted and given its own ORD number; on an order booked in
 * Admin for a portal carrier that was never asked here, it is opened now.
 */
async function syncExecutor(db: Db, row: Order, dispatch: boolean): Promise<void> {
    if (!row.carrierId || !(await isOnPortal(db, row.carrierId))) return;

    const existing = await liveRow(db, row.id, row.carrierId);
    const target = mirrorStatus(row.status, "executor", existing?.status ?? "offered");

    if (!target) return;

    const now = new Date();
    const facts = factsOf(row);
    const rig = dispatch ? await dispatchColumns(db, row) : {};

    if (!existing) {
        // Only a committed order opens a row here. Before that the executing
        // side is candidates, which are `upsertApploadCandidates`' to open —
        // and an un-booked order keeps its previous `carrierId`, so anything
        // laxer re-invites the carrier that was just released
        if (!needsOrderReference(target.status)) return;

        const [created] = await db
            .insert(movement)
            .values({
                organizationId: row.carrierId,
                orderId: row.id,
                execution: "own-fleet",
                status: target.status,
                clientOrgId: APPLOAD_ORG_ID,
                clientName: APPLOAD_ORG_NAME,
                // What Appload calls this load; the carrier's own number is
                // its `reference`
                clientReference: row.orderId,
                reference: needsOrderReference(target.status)
                    ? await nextReference(db, row.carrierId, "ORD", now)
                    : null,
                ...cargoOf(row),
                ...sellLeg(row),
                ...rig,
                ...statusStamps(null, target.status, now),
                trackingEnabled: false,
            })
            .returning();

        if (created) await systemEvent(db, { id: created.id, status: created.status }, facts, created.status);

        return;
    }

    if (needsOrderReference(target.status) && existing.reference === null) {
        await ensureOrderReference(db, existing);
    }

    const moves = target.status !== existing.status;
    const patch = {
        ...(moves && { status: target.status, ...statusStamps(existing, target.status, now) }),
        ...sellLeg(row),
        ...rig,
    };

    if (!moves && !differs(existing, patch)) return;

    const [updated] = await db
        .update(movement)
        .set({ ...patch, version: sql`${movement.version} + 1` })
        .where(and(eq(movement.id, existing.id), eq(movement.status, existing.status)))
        .returning();

    if (!updated) return;

    await systemEvent(db, existing, facts, updated.status);
}

/**
 * Cancels the rows on the executing side of an order — the carrier that was
 * booked and the ones still waiting to hear. `candidatesOnly` leaves a row
 * that already carries its own number alone: that company is booked, and only
 * the order's own doors take that away.
 */
async function cancelLinkedRows(
    db: Db,
    facts: OrderFacts,
    opts: { orgId?: string; exceptOrgId?: string | null; candidatesOnly?: boolean; note?: string | null },
): Promise<void> {
    const rows = await db
        .select()
        .from(movement)
        .where(and(
            eq(movement.orderId, facts.id),
            eq(movement.clientOrgId, APPLOAD_ORG_ID),
            ne(movement.status, "cancelled"),
            opts.candidatesOnly ? inArray(movement.status, ["offered", "prospect"]) : undefined,
            opts.orgId ? eq(movement.organizationId, opts.orgId) : undefined,
            opts.exceptOrgId ? ne(movement.organizationId, opts.exceptOrgId) : undefined,
        ));

    const now = new Date();

    for (const target of rows) {
        const [updated] = await db
            .update(movement)
            .set({
                status: "cancelled",
                ...statusStamps(target, "cancelled", now),
                version: sql`${movement.version} + 1`,
            })
            .where(and(eq(movement.id, target.id), eq(movement.status, target.status)))
            .returning({ id: movement.id });

        if (!updated) continue;

        await systemEvent(db, target, facts, "cancelled", opts.note);
    }
}

/** One offered row per portal carrier the order was sent to. */
export async function upsertApploadCandidates(
    db: Db,
    params: { orderPk: string; carrierOrgIds: string[] },
): Promise<void> {
    const wanted = [...new Set(params.carrierOrgIds)];

    if (wanted.length === 0) return;

    // A company nobody has activated the portal for has no one to read the
    // request: it is asked the way an off-platform carrier always was
    const onPortal = await db
        .select({ id: organization.id })
        .from(organization)
        .where(and(inArray(organization.id, wanted), isNotNull(organization.portalActivatedAt)));

    if (onPortal.length === 0) return;

    const [row] = await db.select().from(order).where(eq(order.id, params.orderPk)).limit(1);

    if (!row) return;

    const facts = factsOf(row);
    const now = new Date();

    for (const carrier of onPortal) {
        // Asking the same carrier twice reopens the request it already has,
        // and its row is already there
        if (await liveRow(db, row.id, carrier.id)) continue;

        const [created] = await db
            .insert(movement)
            .values({
                organizationId: carrier.id,
                orderId: row.id,
                execution: "own-fleet",
                status: "offered",
                clientOrgId: APPLOAD_ORG_ID,
                clientName: APPLOAD_ORG_NAME,
                clientReference: row.orderId,
                // Nothing is committed to yet, so there is no number to give
                reference: null,
                ...cargoOf(row),
                ...statusStamps(null, "offered", now),
                trackingEnabled: false,
            })
            .returning();

        if (created) await systemEvent(db, { id: created.id, status: created.status }, facts, "offered");
    }
}

/** The carrier answered with a price: its row is waiting on the decision. */
export async function markApploadCandidateQuoted(
    db: Db,
    params: { orderPk: string; carrierOrgId: string },
): Promise<void> {
    const facts = await loadFacts(db, params.orderPk);

    if (!facts) return;

    const [updated] = await db
        .update(movement)
        .set({ status: "prospect", version: sql`${movement.version} + 1` })
        .where(and(
            eq(movement.orderId, params.orderPk),
            eq(movement.organizationId, params.carrierOrgId),
            eq(movement.status, "offered"),
        ))
        .returning({ id: movement.id });

    if (!updated) return;

    await systemEvent(db, { id: updated.id, status: "offered" }, facts, "prospect");
}

/** The request to this carrier was taken back: its row is off. */
export async function withdrawApploadCandidate(
    db: Db,
    params: { orderPk: string; carrierOrgId: string },
): Promise<void> {
    const facts = await loadFacts(db, params.orderPk);

    if (!facts) return;

    // This one carrier's row and nobody else's: the others are still waiting
    await cancelLinkedRows(db, facts, {
        orgId: params.carrierOrgId,
        candidatesOnly: true,
        note: REQUEST_WITHDRAWN,
    });
}

/** Nobody else is in the running: every live candidate row is cancelled. */
export async function closeApploadCandidates(
    db: Db,
    params: { orderPk: string; exceptOrgId?: string },
): Promise<void> {
    const facts = await loadFacts(db, params.orderPk);

    if (!facts) return;

    await cancelLinkedRows(db, facts, {
        candidatesOnly: true,
        exceptOrgId: params.exceptOrgId,
        note: params.exceptOrgId ? BOOKED_ELSEWHERE : null,
    });
}

/**
 * This company's own row for an order, by the display id ("APPL021.26") or
 * by the order's primary key. Null when it has none — an order of a company
 * that never activated the portal has no linked row at all.
 */
export async function linkedMovementId(
    db: Db,
    params: { orderId: string; organizationId: string },
): Promise<string | null> {
    const [row] = await db
        .select({ id: movement.id })
        .from(movement)
        .innerJoin(order, eq(order.id, movement.orderId))
        .where(and(
            or(eq(order.orderId, params.orderId), eq(order.id, params.orderId)),
            eq(movement.organizationId, params.organizationId),
            ne(movement.status, "cancelled"),
        ))
        .limit(1);

    return row?.id ?? null;
}
