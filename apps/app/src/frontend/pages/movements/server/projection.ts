import "server-only";

import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Database } from "@workspace/db/db";
import { trailer } from "@workspace/db/fleet";
import {
    movement,
    movementCost,
    movementDispute,
    movementDisputeRow,
    movementDocument,
    movementEvent,
    movementLocation,
    movementTrackingRequest,
    type Movement,
    type MovementDispute,
    type MovementEventKind,
    type MovementStatus,
} from "@workspace/db/movements";
import { organization, user } from "@workspace/db/users";

import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import { terminalMovementId } from "@workspace/domain/movements/link";
import { costTotals, exVat, legSettled, margin } from "@workspace/domain/movements/money";
import { editableGroups, movementRole, type MovementRole } from "@workspace/domain/movements/policy";
import { movementRef } from "@workspace/domain/movements/refs";
import {
    entersInProgress,
    IN_PROGRESS_STATUSES,
    isAskable,
    isInProgress,
    isTerminal,
    MOVEMENT_FLAGS,
    movementFlags,
    ownerTargets,
    PROCUREMENT_STATUSES,
    transitionBlocker,
} from "@workspace/domain/movements/status";
import { MAPUTO_OFFSET_MS } from "@workspace/domain/tracking/slot";

import type {
    Currency,
    MoneyLeg,
    MovementCostView,
    MovementDetail,
    MovementDisputeView,
    MovementDocumentView,
    MovementEventView,
    MovementFlag,
    MovementMoney,
    MovementParty,
    MovementPermissions,
    MovementPing,
    MovementRow,
    MovementScope,
    MovementSection,
} from "@/frontend/pages/movements/types";

/**
 * What each company may see of a movement.
 *
 * This file is the only place a movement column enters a portal response,
 * and every response is built here field by field — never by spreading a
 * row — so a column added to the table next month cannot ride out to a
 * company with no business reading it. The rules, by role:
 *
 *                       owner      executor     client
 *   sell leg            ✓          never        ✓ (what it pays)
 *   buy leg             ✓          ✓ (paid)     never
 *   margin, costs       ✓          never        never
 *   the client          ✓          never        —
 *   the carrier         ✓          —            never
 *   driver phone        ✓          never        never
 *   papers              all        buy + load   sell + load
 *   trail notes         all        offer only   none
 *
 * Two of those are not obvious. The phone never leaves its owner: handing a
 * client or an owner the number of the subcontractor's driver is how the
 * next load goes around the subcontractor, and a transporter's willingness to
 * use this feature at all depends on that not happening. And each company's
 * partners are its own asset — a client never learns who its transporter
 * handed the load to, an executor never learns who the load is for.
 *
 * A dispute is the one thing every company on a load reads in full, because
 * it covers the load in all their books: its reason and description go to
 * every covered row. Who opened it follows the partner rule above — named
 * only when the reader is that company, the opener owns the row being read,
 * or the reader owns the row and the opener is its own client or carrier.
 */

type Db = typeof Database;

// ---------------------------------------------------------------------------
// Visibility and the two lists
// ---------------------------------------------------------------------------

/**
 * Every movement this company is a side of. The owner, the client named on
 * it, and the executor while it is actually involved — the offer in front
 * of it, its own answer, or its truck linked below. Composed into every read.
 */
export const visibleMovements = (tenantId: string): SQL =>
    or(
        eq(movement.organizationId, tenantId),
        eq(movement.clientOrgId, tenantId),
        and(
            eq(movement.carrierOrgId, tenantId),
            or(inArray(movement.status, ["offered", "declined"]), isNotNull(movement.executionMovementId)),
        ),
    ) as SQL;

const ownOrder = alias(movement, "own_order");

/** The second face on a document row: whoever approved a loading photo. */
const approver = alias(user, "approver");

/**
 * A load another company runs naming this one as its client — unless this
 * company already holds its own order linked to it. When a client places a
 * load with a transporter on the portal, both companies end up with a row:
 * the client's order, and the transporter's own row naming the client. The
 * client reads the load through its own order; listing the transporter's row
 * beside it would show the same truck twice.
 *
 * Written as a drizzle condition inside the subquery rather than as bare
 * columns: a column interpolated straight into a template loses its table
 * prefix when the outer query has no joins, and `id` would then bind to the
 * aliased inner table instead of the row being tested. The FROM spells the
 * alias out by hand for the opposite reason — an alias object interpolated
 * into a template renders as its bare name, with no table behind it.
 */
const forMe = (tenantId: string): SQL =>
    and(
        eq(movement.clientOrgId, tenantId),
        ne(movement.organizationId, tenantId),
        sql`not exists (select 1 from ${movement} as ${sql.identifier("own_order")} where ${and(
            eq(ownOrder.organizationId, tenantId),
            eq(ownOrder.executionMovementId, movement.id),
        )})`,
    ) as SQL;

/**
 * The loads a company has a truck on, once each: in progress — from the
 * loading site to offloading, stops included — on its own rows, and on the
 * ones moved for it that it does not already hold an order for. The rows it
 * was only offered stay off — a partner that accepted works the load from
 * its own row, which this already includes.
 */
export const onTheMap = (tenantId: string): SQL =>
    and(
        inArray(movement.status, IN_PROGRESS_STATUSES),
        or(eq(movement.organizationId, tenantId), forMe(tenantId)),
    ) as SQL;

/**
 * Today's slot date in Maputo — the key the tracking cron writes its request
 * rows under, so "asked today" means exactly the rows it claimed.
 */
const slotDateToday = (now: Date) => new Date(now.getTime() + MAPUTO_OFFSET_MS).toISOString().slice(0, 10);

/** Midnight in Maputo as the UTC instant the pings are timestamped in. */
const startOfDay = (now: Date) => new Date(Date.parse(`${slotDateToday(now)}T00:00:00Z`) - MAPUTO_OFFSET_MS);

/**
 * Loads whose driver this company asked for a position today and who has
 * not answered: a request the cron sent (or saw delivered) under today's
 * slot date, and no pin since midnight. Only the rows the company pings
 * itself — in progress, and not handed to a partner who tracks its own
 * truck; how a partner's driver answers the partner is the partner's
 * business.
 *
 * The conditions go in as drizzle expressions rather than as bare columns —
 * a column interpolated straight into a template loses its table prefix
 * when the outer query has no joins, and `movement_id` would then bind to
 * the subquery's own table.
 */
export const silentToday = (tenantId: string, now: Date): SQL =>
    and(
        eq(movement.organizationId, tenantId),
        inArray(movement.status, IN_PROGRESS_STATUSES),
        isNull(movement.executionMovementId),
        sql`exists (
            select 1 from ${movementTrackingRequest} where ${and(
                eq(movementTrackingRequest.movementId, movement.id),
                eq(movementTrackingRequest.slotDate, slotDateToday(now)),
                inArray(movementTrackingRequest.status, ["sent", "delivered"]),
            )}
        )`,
        sql`not exists (
            select 1 from ${movementLocation} where ${and(
                eq(movementLocation.movementId, movement.id),
                gte(movementLocation.recordedAt, startOfDay(now)),
            )}
        )`,
    ) as SQL;

/** Loads somebody else moves for this company. */
const orderBase = (tenantId: string): SQL =>
    or(and(eq(movement.execution, "partner"), eq(movement.organizationId, tenantId)), forMe(tenantId)) as SQL;

/**
 * Loads partners have offered this company and are waiting on. On Trips,
 * because answering one is planning work for its own truck.
 */
export const received = (tenantId: string): SQL =>
    and(eq(movement.carrierOrgId, tenantId), eq(movement.status, "offered")) as SQL;

/** Loads this company's own fleet moves. */
const tripBase = (tenantId: string): SQL =>
    and(eq(movement.execution, "own-fleet"), eq(movement.organizationId, tenantId)) as SQL;

/**
 * A load covered by an open dispute, wherever on its chain the dispute was
 * opened — read off the rows the dispute pinned. The condition goes in as a
 * drizzle expression for the same reason `silentToday`'s do.
 */
export const inDispute = (): SQL =>
    sql`exists (
        select 1 from ${movementDisputeRow} where ${and(
            eq(movementDisputeRow.movementId, movement.id),
            eq(movementDisputeRow.open, true),
        )}
    )`;

/** One section of one list. Unknown sections read as "all" of the list. */
export function sectionPredicate(scope: MovementScope, section: MovementSection, tenantId: string): SQL {
    if (scope === "orders") {
        const base = orderBase(tenantId);

        switch (section) {
            case "procurement": return and(base, inArray(movement.status, PROCUREMENT_STATUSES)) as SQL;
            case "booked": return and(base, eq(movement.status, "booked")) as SQL;
            case "in-progress": return and(base, inArray(movement.status, IN_PROGRESS_STATUSES)) as SQL;
            case "delivered": return and(base, eq(movement.status, "delivered")) as SQL;
            case "disputes": return and(base, inDispute()) as SQL;
            case "history": return and(base, inArray(movement.status, ["closed", "cancelled"])) as SQL;
            default: return base;
        }
    }

    const base = tripBase(tenantId);

    switch (section) {
        // An offer waiting on this company's answer is planning too, until it
        // is answered — a yes becomes a row of its own in `base`
        case "planning": return or(
            and(base, inArray(movement.status, ["procurement", "prospect", "scheduled"])),
            received(tenantId),
        ) as SQL;
        case "scheduled": return and(base, eq(movement.status, "booked")) as SQL;
        case "in-progress": return and(base, inArray(movement.status, IN_PROGRESS_STATUSES)) as SQL;
        case "delivered": return and(base, eq(movement.status, "delivered")) as SQL;
        case "disputes": return and(base, inDispute()) as SQL;
        case "history": return and(base, inArray(movement.status, ["closed", "cancelled"])) as SQL;
        default: return or(base, received(tenantId)) as SQL;
    }
}

/**
 * A list narrowed to one of its section's tabs. "prospect" is the wait for an
 * answer however it was asked — set by hand, or offered on the portal.
 */
export const statusFilter = (status: MovementStatus): SQL =>
    status === "prospect" ? inArray(movement.status, ["prospect", "offered"]) : eq(movement.status, status);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * One movement the caller may read, with its role, or a 404. Never a 403:
 * telling a stranger that a load exists is already telling them something.
 */
export async function loadVisible(db: Db, id: string, tenantId: string): Promise<{ row: Movement; role: MovementRole }> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(eq(movement.id, id), visibleMovements(tenantId)))
        .limit(1);

    const role = row ? movementRole(row, tenantId) : null;

    if (!row || !role) throw notFound();

    return { row, role };
}

/** The same, for writes only the owner may make. */
export async function loadOwn(db: Db, id: string, tenantId: string): Promise<Movement> {
    const [row] = await db
        .select()
        .from(movement)
        .where(and(eq(movement.id, id), eq(movement.organizationId, tenantId)))
        .limit(1);

    if (!row) throw notFound();

    return row;
}

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

/** The display names of the companies a page of rows mentions, in one query. */
export async function loadNames(db: Db, ids: Iterable<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];

    if (unique.length === 0) return new Map();

    const rows = await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(inArray(organization.id, unique));

    return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The address a company is written to. Read on the detail page for the
 * partner a load was placed with, so the owner does not have to retype an
 * address it already sees on the partner's own page.
 */
/**
 * The plate of the trailer assigned to a load. Read on its own rather than
 * joined into the row: only the detail needs it, and only to print it on the
 * confirmation the partner receives — a transport order that omits the
 * trailer reads as a load that has none.
 */
export async function loadTrailerPlate(db: Db, trailerId: string): Promise<string | null> {
    const [row] = await db
        .select({ plate: trailer.regPlate })
        .from(trailer)
        .where(eq(trailer.id, trailerId))
        .limit(1);

    return row?.plate ?? null;
}

export async function loadOrgEmail(db: Db, organizationId: string): Promise<string | null> {
    const [row] = await db
        .select({ email: organization.email })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

    return row?.email ?? null;
}

/**
 * Which row's trail each movement shows. A linked order has no pings of its
 * own — its truck reports on the executor's row — so it borrows the trail of
 * the row at the end of its chain. Only the positions travel up: nothing of
 * that row but its pings is ever read on the owner's behalf.
 */
export async function trailIds(db: Db, rows: readonly Movement[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    for (const row of rows) {
        map.set(row.id, row.executionMovementId ? await terminalMovementId(db, row.id) : row.id);
    }

    return map;
}

/** What of the row with the truck travels up a chain besides its pings. */
export type TerminalRig = { driverName: string | null; truckPlate: string | null };

/**
 * The driver's name and the plate from the row with the truck, for the
 * linked rows on a page. A client waiting on a load asks which truck is
 * coming, and an owner has no rig of its own on a load it handed on — so
 * these two travel up with the positions, and nothing else of that row does:
 * not its phone (the executor's alone), not its money, not its client.
 */
export async function loadTerminalRigs(db: Db, terminalIds: readonly string[]): Promise<Map<string, TerminalRig>> {
    if (terminalIds.length === 0) return new Map();

    const rows = await db
        .select({ id: movement.id, driverName: movement.driverName, truckPlate: movement.truckPlate })
        .from(movement)
        .where(inArray(movement.id, [...new Set(terminalIds)]));

    return new Map(rows.map((row) => [row.id, { driverName: row.driverName, truckPlate: row.truckPlate }]));
}

/**
 * The proof a load arrived, from the row with the truck. The one paper that
 * belongs to everybody on a chain: the executor produces it, and the client
 * at the top is the one waiting for it. Only the load's own papers (no leg)
 * of the kinds that prove delivery; the uploader is not named, since that
 * person works for a company the viewer may not be meant to know.
 */
export async function loadTerminalProofs(db: Db, terminalId: string): Promise<MovementDocumentView[]> {
    const rows = await loadDocuments(db, terminalId);

    return rows
        .filter((document) => document.leg === null && (document.type === "pod" || document.type === "cmr"))
        .map((document) => ({ ...document, uploadedByName: null, approvedByName: null, fromExecutor: true }));
}

export type PingState = {
    last: Map<string, MovementPing>;
    counts: Map<string, number>;
};

/**
 * The last ping and the ping count per trail. Two flat queries rather than a
 * join: a trail has as many rows as the driver sent pins, and a join would
 * multiply the movement.
 */
export async function loadPings(db: Db, ids: readonly string[]): Promise<PingState> {
    if (ids.length === 0) return { last: new Map(), counts: new Map() };

    const unique = [...new Set(ids)];

    const [latest, counted] = await Promise.all([
        db
            .selectDistinctOn([movementLocation.movementId], {
                movementId: movementLocation.movementId,
                latitude: movementLocation.latitude,
                longitude: movementLocation.longitude,
                placeName: movementLocation.placeName,
                placeLabel: movementLocation.placeLabel,
                recordedAt: movementLocation.recordedAt,
            })
            .from(movementLocation)
            .where(inArray(movementLocation.movementId, unique))
            .orderBy(movementLocation.movementId, desc(movementLocation.recordedAt)),
        db
            .select({ movementId: movementLocation.movementId, pings: count() })
            .from(movementLocation)
            .where(inArray(movementLocation.movementId, unique))
            .groupBy(movementLocation.movementId),
    ]);

    return {
        last: new Map(latest.map((ping) => [ping.movementId, {
            recordedAt: ping.recordedAt,
            latitude: Number(ping.latitude),
            longitude: Number(ping.longitude),
            placeName: ping.placeName,
            placeLabel: ping.placeLabel,
        }])),
        counts: new Map(counted.map((row) => [row.movementId, row.pings])),
    };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const num = (value: string | null): number | null => (value === null ? null : Number(value));

/** One leg as a view, or null when it was never priced. */
function leg(row: Movement, side: "sell" | "buy"): MoneyLeg | null {
    const sell = side === "sell";
    const total = sell ? row.sellTotal : row.buyTotal;
    const currency = sell ? row.sellCurrency : row.buyCurrency;

    if (total === null || currency === null) return null;

    return {
        subtotal: num(sell ? row.sellSubtotal : row.buySubtotal),
        vat: num(sell ? row.sellVat : row.buyVat),
        total: Number(total),
        currency,
        fiscalRegime: sell ? row.sellFiscalRegime : row.buyFiscalRegime,
        invoiceNumber: sell ? row.sellInvoiceNumber : row.buyInvoiceNumber,
        invoiceDate: sell ? row.sellInvoiceDate : row.buyInvoiceDate,
        settlement: (sell ? row.sellSettlement : row.buySettlement) ?? "pending",
        settled: Number((sell ? row.sellReceivedAmount : row.buyPaidAmount) ?? 0),
        settledAt: sell ? row.sellSettledAt : row.buySettledAt,
    };
}

export type CostRow = {
    id: string;
    kind: MovementCostView["kind"];
    description: string | null;
    amount: string;
    currency: Currency;
    incurredAt: Date;
    rechargeable: boolean;
    createdAt: Date;
};

/**
 * The legs as this caller reads them. An own-fleet load has no buy leg by
 * construction (a CHECK on the table), so the owner's `payable` is null there
 * and its margin is the sell leg less what the load cost to run.
 */
export function projectMoney(row: Movement, role: MovementRole, costs: readonly CostRow[]): MovementMoney {
    if (role === "executor") return { payable: null, receivable: leg(row, "buy"), margin: null };
    if (role === "client") return { payable: leg(row, "sell"), receivable: null, margin: null };

    const sell = leg(row, "sell");
    const buy = row.execution === "partner" ? leg(row, "buy") : null;
    const totals = costTotals(costs.map((cost) => ({
        kind: cost.kind,
        amount: Number(cost.amount),
        currency: cost.currency,
        rechargeable: cost.rechargeable,
    })));

    return {
        payable: buy,
        receivable: sell,
        margin: {
            ...margin({
                sell: sell && { amount: exVat(sell), currency: sell.currency },
                buy: buy && { amount: exVat(buy), currency: buy.currency },
                ownFleet: row.execution === "own-fleet",
                costs: totals,
            }),
            costs: totals,
        },
    };
}

const headline = (value: MoneyLeg | null) => (value ? { total: value.total, currency: value.currency } : null);

/**
 * What the guards and the flags read off a row: its own columns, whether each
 * leg is settled — an own-fleet load has no partner to pay — whether the truck
 * is somebody else's, how many loading photos are still waiting to be
 * validated (counted where the detail reads the papers from), and whether a
 * dispute still holds its books open.
 */
const guardsOf = (row: Movement, unapprovedPhotos: number, disputeOpen: boolean) => ({
    ...row,
    sellSettled: legSettled(row.sellTotal, row.sellSettlement),
    buySettled: row.execution === "own-fleet" || legSettled(row.buyTotal, row.buySettlement),
    linked: row.executionMovementId !== null,
    unapprovedPhotos,
    disputeOpen,
});

// ---------------------------------------------------------------------------
// Rows and details
// ---------------------------------------------------------------------------

const party = (id: string | null, fallback: string | null, names: Map<string, string>): MovementParty | null =>
    id ? { id, name: names.get(id) ?? null } : fallback ? { id: null, name: fallback } : null;

export function toMovementRow(
    row: Movement,
    role: MovementRole,
    ctx: {
        names: Map<string, string>;
        pings: PingState;
        trailId: string;
        terminalRig?: TerminalRig | null;
        /** Read by whoever shows it: the list (`loadDisputed`) and the detail */
        inDispute?: boolean;
    },
): MovementRow {
    const owner = role === "owner";
    // The list shows headlines only; costs are not read for it, and the
    // margin is the detail page's
    const money = projectMoney(row, role, []);

    return {
        id: row.id,
        ref: movementRef(row.seq, row.execution),
        execution: row.execution,
        status: row.status,
        role,
        origin: row.origin,
        destination: row.destination,
        cargoDescription: row.cargoDescription,
        expectedLoadingDate: row.expectedLoadingDate,
        expectedDeliveryAt: row.expectedDeliveryAt,
        startedAt: row.startedAt,
        deliveredAt: row.deliveredAt,
        owner: owner ? null : party(row.organizationId, null, ctx.names),
        client: owner ? party(row.clientOrgId, row.clientName, ctx.names) : null,
        carrier: owner ? party(row.carrierOrgId, row.carrierName, ctx.names) : null,
        // A linked row has no rig of its own; the truck carrying it is below
        driverName: row.executionMovementId ? ctx.terminalRig?.driverName ?? null : row.driverName,
        truckPlate: row.executionMovementId ? ctx.terminalRig?.truckPlate ?? null : row.truckPlate,
        payable: headline(money.payable),
        receivable: headline(money.receivable),
        isLinked: owner && row.executionMovementId !== null,
        inDispute: ctx.inDispute ?? false,
        lastPing: ctx.pings.last.get(ctx.trailId) ?? null,
        pingCount: ctx.pings.counts.get(ctx.trailId) ?? 0,
        version: row.version,
        createdAt: row.createdAt,
    };
}

/** Which papers a role may read: every side sees the load's own. */
const documentLegsFor = (role: MovementRole): readonly ("sell" | "buy" | null)[] =>
    role === "owner" ? ["sell", "buy", null] : role === "executor" ? ["buy", null] : ["sell", null];

/**
 * Which trail lines a role may read. Money and costs are the owner's; a
 * dispute is everybody's on the load, and who opened it is still cut by
 * `nameable` below.
 */
const eventKindsFor = (role: MovementRole): readonly MovementEventKind[] =>
    role === "owner"
        ? ["status", "offer", "update", "money", "cost", "document", "note", "system", "dispute"]
        : role === "executor"
            // The offer and its answer are between the two of them
            ? ["status", "offer", "system", "dispute"]
            // A client follows the load, not how its transporter sourced it
            : ["status", "system", "dispute"];

/** A dispute covering the row a detail is read for, with what naming its opener needs. */
export type DisputeRow = Pick<
    MovementDispute,
    "id" | "openedByOrgId" | "reason" | "description" | "status" | "resolution" | "openedAt" | "resolvedAt"
> & {
    openerName: string;
    /**
     * Opened on a row above this one in the chain. A chain's rows are created
     * top down — each executor's row at the moment it accepts — so this holds
     * even after a back-out has unlinked the two.
     */
    fromAbove: boolean;
};

type DetailExtras = {
    /** The company reading — an executor's view is cut to its own offer round */
    tenantId: string;
    terminalRig: TerminalRig | null;
    /** A linked row's proof of delivery, from the row with the truck */
    terminalProofs: readonly MovementDocumentView[];
    /** The partner's address, read for the owner alone */
    carrierEmail: string | null;
    /** The assigned trailer's plate, likewise the owner's */
    trailerPlate: string | null;
    names: Map<string, string>;
    pings: PingState;
    trailId: string;
    hasParent: boolean;
    executorOnPortal: boolean;
    costs: readonly CostRow[];
    documents: readonly MovementDocumentView[];
    /** Loading photos nobody has validated on the row the papers are read from */
    unapprovedPhotos: number;
    events: readonly (Omit<MovementEventView, "action" | "sentTo" | "flags"> & { metadata: unknown; actorOrgId: string | null })[];
    /** Every dispute covering the row, newest first */
    disputes: readonly DisputeRow[];
    orgRole: OrgRole;
};

export function toMovementDetail(row: Movement, role: MovementRole, extras: DetailExtras): MovementDetail {
    const owner = role === "owner";
    const money = projectMoney(row, role, owner ? extras.costs : []);
    const legs = documentLegsFor(role);
    const kinds = eventKindsFor(role);

    // An executor sees this load from the moment it was offered the load, and
    // nothing from before. The row outlives any one carrier: an owner whose
    // first carrier declined — or accepted and then backed out — places the
    // same row with the next one, and the earlier round's messages, answers
    // and papers are between the owner and that earlier carrier. Anchored on
    // the offer event rather than on `offeredAt`, since events and papers are
    // stamped by the database clock and `offeredAt` by the server's.
    const roundStart = role === "executor"
        ? extras.events.find((event) =>
            event.kind === "offer" && event.actorOrgId === row.organizationId && readAction(event.metadata) === "offered",
        )?.createdAt ?? null
        : null;
    const inRound = (createdAt: Date) => role !== "executor" || (roundStart !== null && createdAt >= roundStart);
    // The companies this caller may see named on the trail: itself, the owner,
    // and nobody when a move was carried up from below
    const nameable = (actorOrgId: string | null) =>
        owner || actorOrgId === null || actorOrgId === extras.tenantId || actorOrgId === row.organizationId;

    // Whether a dispute holds the row, whoever opened it and whenever: what
    // closing and opening another are decided on, the way the doors decide
    const disputeOpen = extras.disputes.some((dispute) => dispute.status === "open");
    // The one the page shows. A load handed back and placed again keeps the
    // dispute pinned to it, and the next executor is not told of it — the
    // same round that cuts its trail cuts this
    const readable = extras.disputes.filter((dispute) => inRound(dispute.openedAt));
    const dispute = readable.find((entry) => entry.status === "open")
        ?? readable.find((entry) => entry.status === "resolved")
        ?? null;
    // What this caller may be told the row is under: a chip for a dispute it
    // cannot read would be telling it that dispute exists
    const disputeVisible = dispute?.status === "open";

    return {
        ...toMovementRow(row, role, { ...extras, inDispute: disputeVisible }),
        route: row.route,
        category: row.category,
        weight: num(row.weight),
        weightUnit: row.weightUnit,
        closedAt: row.closedAt,
        trackingEnabled: row.trackingEnabled,
        notes: owner ? row.notes : null,
        clientReference: role === "executor" ? null : row.clientReference,
        carrierEmail: owner ? extras.carrierEmail : null,
        driverPhone: owner ? row.driverPhone : null,
        driverId: owner ? row.driverId : null,
        truckId: owner ? row.truckId : null,
        trailerId: owner ? row.trailerId : null,
        trailerPlate: owner ? extras.trailerPlate : null,
        linkId: owner ? row.linkId : null,
        offeredAt: role === "client" ? null : row.offeredAt,
        respondedAt: role === "client" ? null : row.respondedAt,
        responseNote: role === "client" ? null : row.responseNote,
        hasParent: owner && extras.hasParent,
        // What the load is missing as it stands. The owner's own reading of
        // its own books: nobody else is told what its paperwork lacks
        flags: owner ? movementFlags(guardsOf(row, extras.unapprovedPhotos, disputeOpen), row.status) : [],
        money,
        costs: owner
            ? extras.costs.map((cost) => ({
                id: cost.id,
                kind: cost.kind,
                description: cost.description,
                amount: Number(cost.amount),
                currency: cost.currency,
                incurredAt: cost.incurredAt,
                rechargeable: cost.rechargeable,
                createdAt: cost.createdAt,
            }))
            : [],
        documents: [
            // A loading photo carries no leg, so every side reads it — but
            // whether the load's own manager has looked at it yet, and which
            // of its people did, is that company's business alone
            ...extras.documents
                .filter((document) => legs.includes(document.leg) && inRound(document.createdAt))
                .map((document) => (owner ? document : { ...document, approvedAt: null, approvedByName: null })),
            ...extras.terminalProofs,
        ],
        events: extras.events
            .filter((event) => kinds.includes(event.kind) && inRound(event.createdAt) && nameable(event.actorOrgId))
            .map((event) => ({
                id: event.id,
                kind: event.kind,
                fromStatus: event.fromStatus,
                toStatus: event.toStatus,
                // A note is its writer's: an offer's message is meant for the
                // executor, everything else stays with the owner
                note: owner || (role === "executor" && event.kind === "offer") ? event.note : null,
                action: readAction(event.metadata),
                sentTo: readText(event.metadata, "sentTo"),
                actorName: event.actorName,
                // As on the load itself: what a move was taken without is the
                // owner's own business, and its client is the last company
                // that should read it off the trail
                flags: owner ? readFlags(event.metadata) : [],
                createdAt: event.createdAt,
            })),
        dispute: dispute && disputeView(dispute, row, role, extras),
        permissions: permissionsFor(row, role, extras, disputeOpen),
        updatedAt: row.updatedAt,
    };
}

/**
 * A dispute as this caller may read it. The opener is placed by its relation
 * to the row being read, and named only under the partner rule in the header:
 * the caller's own company, the row's owner, or — to the row's owner — its
 * own client or carrier. A company further along the chain is only "a
 * company on this load": above the row it stands where the client does,
 * below it where the executor does.
 */
function disputeView(dispute: DisputeRow, row: Movement, role: MovementRole, extras: DetailExtras): MovementDisputeView {
    const opener = dispute.openedByOrgId;
    const side = opener === extras.tenantId
        ? "you"
        : opener === row.organizationId
            ? "owner"
            : opener === row.carrierOrgId
                ? "executor"
                : opener === row.clientOrgId || dispute.fromAbove ? "client" : "executor";
    const named = opener === extras.tenantId
        || opener === row.organizationId
        || (role === "owner" && (opener === row.clientOrgId || opener === row.carrierOrgId));

    return {
        id: dispute.id,
        reason: dispute.reason,
        description: dispute.description,
        status: dispute.status,
        openedAt: dispute.openedAt,
        openedBy: { side, name: named ? dispute.openerName : null },
        resolution: dispute.resolution,
        resolvedAt: dispute.resolvedAt,
        // Settling it speaks for the company that raised it, at a manager's role
        canResolve: dispute.status === "open"
            && opener === extras.tenantId
            && isOrgAuthorized(extras.orgRole, "dispute", ["resolve"]),
    };
}

/** A string the writer of an event put on it, when it put one there. */
function readText(metadata: unknown, key: string): string | null {
    if (metadata && typeof metadata === "object" && key in metadata) {
        const value = (metadata as Record<string, unknown>)[key];
        return typeof value === "string" ? value : null;
    }
    return null;
}

const readAction = (metadata: unknown): string | null => readText(metadata, "action");

/**
 * What a move was taken without, as its writer comma-joined it. Read back
 * against the vocabulary rather than trusted: the column is jsonb, and a flag
 * retired next month must not reach the page as a message key nobody has.
 */
function readFlags(metadata: unknown): MovementFlag[] {
    const raw = readText(metadata, "flags");

    if (!raw) return [];

    return raw.split(",").filter((value): value is MovementFlag => (MOVEMENT_FLAGS as readonly string[]).includes(value));
}

/**
 * What a move on a partner load takes beyond `order:update`, or null. Taking
 * a draft or a quote forward — to a quote, an agreement, a booking or a truck
 * on it — is placing the load, committing the company to paying somebody,
 * and calling one off unwinds that; both are above the plain member's role,
 * the same way offering is. Taking a quote or a refusal back to the draft is
 * only updating it. The door (procedures.ts) and the buttons both ask here.
 */
export function partnerMoveNeeds(from: MovementStatus, to: MovementStatus): "create" | "cancel" | null {
    if (to === "cancelled") return "cancel";

    if ((from === "procurement" || from === "prospect")
        && (to === "prospect" || to === "scheduled" || to === "booked" || isInProgress(to))) {
        return "create";
    }

    return null;
}

/**
 * What the caller may do now. Decided here, from the same functions the
 * doors enforce, so a button on the page is a promise the server keeps —
 * and it includes the member's own role in the company, since a button the
 * company could press but this member cannot is still a button that fails.
 */
function permissionsFor(
    row: Movement,
    role: MovementRole,
    extras: DetailExtras,
    /** A dispute holds the row, whoever opened it: what the doors decide on */
    disputeOpen: boolean,
): MovementPermissions {
    const can = (resource: "trip" | "order" | "offer" | "document" | "dispute", action: string) =>
        isOrgAuthorized(extras.orgRole, resource, [action] as never);

    const none: MovementPermissions = {
        transitions: [],
        editable: [],
        canOffer: false,
        canWithdraw: false,
        canRespond: role === "executor" && row.status === "offered" && can("offer", "update"),
        canConvert: false,
        canManageCosts: false,
        canManageDocuments: false,
        canApproveDocuments: false,
        canRecordPayment: false,
        canRequestLocation: false,
        canReadThread: false,
        // Every company on the load, whatever its role: once somebody has
        // committed to moving it and until its books are over, and one
        // dispute at a time — the pin itself, whoever may read it, since the
        // door turns a second dispute on a held row down whatever the caller
        // knows of the first, and a button that can only fail would announce
        // the very dispute the page keeps from it. A caller handed the load
        // after one was raised still raises its own on the row it runs: that
        // row is its own, and carries no pin
        canOpenDispute: !isAskable(row.status) && !isTerminal(row.status) && !disputeOpen && can("dispute", "open"),
    };

    if (role !== "owner") return none;

    const partner = row.execution === "partner";
    const linked = row.executionMovementId !== null;
    const writeResource = partner ? "order" : "trip";
    const mayWrite = can(writeResource, "update");
    const shape = {
        execution: row.execution,
        status: row.status,
        route: row.route,
        resumeStatus: row.resumeStatus,
        linked,
        executorOnPortal: extras.executorOnPortal,
    };
    const guards = guardsOf(row, extras.unapprovedPhotos, disputeOpen);

    return {
        transitions: mayWrite
            ? ownerTargets(shape).filter((to) => {
                const needs = partner ? partnerMoveNeeds(row.status, to) : null;
                return needs === null || can("order", needs);
            }).map((to) => {
                // A reason is typed in the dialog that takes the move, so it
                // is reported as a field to ask for, never as a blocker
                const blocker = transitionBlocker(guards, to, null);
                const needsNote = blocker === "NOTE_REQUIRED";

                return {
                    to,
                    blocker: needsNote ? transitionBlocker(guards, to, "noted") : blocker,
                    needsNote,
                    // What the move would be taken without, so the dialog can
                    // say so before the trail records it — an interruption
                    // judged at the stage it interrupts (status.ts)
                    flags: movementFlags(guards, to),
                    startsTracking: entersInProgress(row.status, to),
                };
            })
            : [],
        editable: mayWrite
            ? editableGroups({ ...shape, hasParent: extras.hasParent, disputeOpen })
            : [],
        canOffer: partner && !linked && extras.executorOnPortal
            && (row.status === "procurement" || row.status === "declined") && can("order", "create"),
        canWithdraw: row.status === "offered" && can("order", "update"),
        canRespond: false,
        canConvert: can("order", "create") && (
            partner
                ? !linked && (row.status === "procurement" || row.status === "prospect" || row.status === "declined")
                : row.status === "procurement" || row.status === "prospect" || row.status === "scheduled" || row.status === "booked"
        ),
        canManageCosts: !isTerminal(row.status) && can("trip", "update"),
        canManageDocuments: can("document", "upload"),
        // Anybody on the load files a photo; validating one is answering for
        // what left the warehouse, and only this company can do it — the
        // approval is on the row whose truck is being loaded
        canApproveDocuments: can("document", "approve"),
        canRecordPayment: row.status !== "cancelled" && (row.sellTotal !== null || (partner && row.buyTotal !== null))
            && can("order", "update"),
        canRequestLocation: isInProgress(row.status) && !linked && Boolean(row.driverPhone) && can("trip", "update"),
        // Reading follows the phone: whoever may see the number may see what
        // was said to it, and a linked order's driver belongs to the executor
        // Only a conversation this row's own asking stamped is readable, so
        // the card is offered on that, not on a typed number
        canReadThread: !linked && Boolean(row.conversationId),
        canOpenDispute: none.canOpenDispute,
    };
}

// ---------------------------------------------------------------------------
// The detail page's satellites
// ---------------------------------------------------------------------------

export async function loadCosts(db: Db, movementId: string): Promise<CostRow[]> {
    const rows = await db
        .select({
            id: movementCost.id,
            kind: movementCost.kind,
            description: movementCost.description,
            amount: movementCost.amount,
            currency: movementCost.currency,
            incurredAt: movementCost.incurredAt,
            rechargeable: movementCost.rechargeable,
            createdAt: movementCost.createdAt,
            deletedAt: movementCost.deletedAt,
        })
        .from(movementCost)
        .where(eq(movementCost.movementId, movementId))
        .orderBy(desc(movementCost.incurredAt));

    return rows.filter((row) => row.deletedAt === null);
}

export async function loadDocuments(db: Db, movementId: string): Promise<MovementDocumentView[]> {
    const rows = await db
        .select({
            id: movementDocument.id,
            type: movementDocument.type,
            leg: movementDocument.leg,
            title: movementDocument.title,
            url: movementDocument.url,
            size: movementDocument.size,
            mimeType: movementDocument.mimeType,
            costId: movementDocument.costId,
            uploadedByName: user.name,
            approvedAt: movementDocument.approvedAt,
            approvedByName: approver.name,
            createdAt: movementDocument.createdAt,
            deletedAt: movementDocument.deletedAt,
        })
        .from(movementDocument)
        .leftJoin(user, eq(user.id, movementDocument.uploadedBy))
        .leftJoin(approver, eq(approver.id, movementDocument.approvedBy))
        .where(eq(movementDocument.movementId, movementId))
        .orderBy(desc(movementDocument.createdAt));

    return rows
        .filter((row) => row.deletedAt === null)
        .map(({ deletedAt: _deleted, ...document }) => ({ ...document, fromExecutor: false }));
}

export async function loadEvents(db: Db, movementId: string): Promise<DetailExtras["events"]> {
    const rows = await db
        .select({
            id: movementEvent.id,
            kind: movementEvent.kind,
            fromStatus: movementEvent.fromStatus,
            toStatus: movementEvent.toStatus,
            note: movementEvent.note,
            metadata: movementEvent.metadata,
            actorOrgId: movementEvent.actorOrgId,
            actorName: organization.name,
            createdAt: movementEvent.createdAt,
        })
        .from(movementEvent)
        .leftJoin(organization, eq(organization.id, movementEvent.actorOrgId))
        .where(eq(movementEvent.movementId, movementId))
        .orderBy(desc(movementEvent.createdAt));

    return rows;
}

/** Whether this row is an executor's copy of an order another company placed. */
export async function hasParentRow(db: Db, movementId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: movement.id })
        .from(movement)
        .where(eq(movement.executionMovementId, movementId))
        .limit(1);

    return Boolean(row);
}

const openedOn = alias(movement, "opened_on");

/** Every dispute covering a row, newest first — toMovementDetail decides which one, and how much of it, is read. */
export async function loadDisputes(db: Db, row: Movement): Promise<DisputeRow[]> {
    const rows = await db
        .select({
            id: movementDispute.id,
            openedByOrgId: movementDispute.openedByOrgId,
            openerName: organization.name,
            reason: movementDispute.reason,
            description: movementDispute.description,
            status: movementDispute.status,
            resolution: movementDispute.resolution,
            openedAt: movementDispute.openedAt,
            resolvedAt: movementDispute.resolvedAt,
            openedOnCreatedAt: openedOn.createdAt,
        })
        .from(movementDisputeRow)
        .innerJoin(movementDispute, eq(movementDispute.id, movementDisputeRow.disputeId))
        .innerJoin(organization, eq(organization.id, movementDispute.openedByOrgId))
        .innerJoin(openedOn, eq(openedOn.id, movementDispute.movementId))
        .where(eq(movementDisputeRow.movementId, row.id))
        .orderBy(desc(movementDispute.openedAt));

    return rows.map(({ openedOnCreatedAt, ...dispute }) => ({ ...dispute, fromAbove: openedOnCreatedAt < row.createdAt }));
}

/**
 * The rows of a page an open dispute covers. Raw: the list decides who may
 * be told (procedures.ts `projectRows`).
 */
export async function loadDisputed(db: Db, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const rows = await db
        .select({ id: movement.id })
        .from(movement)
        .where(and(inArray(movement.id, [...ids]), inDispute()));

    return new Set(rows.map((row) => row.id));
}
