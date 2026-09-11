import "server-only";

import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Database } from "@workspace/db/db";
import {
    movement,
    movementCost,
    movementDocument,
    movementEvent,
    movementLocation,
    type Movement,
    type MovementEventKind,
} from "@workspace/db/movements";
import { organization, user } from "@workspace/db/users";

import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import { terminalMovementId } from "@workspace/domain/movements/link";
import { costTotals, legSettled, margin } from "@workspace/domain/movements/money";
import { editableGroups, movementRole, type MovementRole } from "@workspace/domain/movements/policy";
import { movementRef } from "@workspace/domain/movements/refs";
import { isTerminal, ownerTargets, transitionBlocker } from "@workspace/domain/movements/status";

import type {
    Currency,
    MoneyLeg,
    MovementCostView,
    MovementDetail,
    MovementDocumentView,
    MovementEventView,
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

/** Loads somebody else moves for this company. */
const orderBase = (tenantId: string): SQL =>
    or(and(eq(movement.execution, "partner"), eq(movement.organizationId, tenantId)), forMe(tenantId)) as SQL;

/** Loads partners have offered this company and are waiting on. */
const inbox = (tenantId: string): SQL =>
    and(eq(movement.carrierOrgId, tenantId), eq(movement.status, "offered")) as SQL;

/** Loads this company's own fleet moves. */
const tripBase = (tenantId: string): SQL =>
    and(eq(movement.execution, "own-fleet"), eq(movement.organizationId, tenantId)) as SQL;

/** One section of one list. Unknown sections read as "all" of the list. */
export function sectionPredicate(scope: MovementScope, section: MovementSection, tenantId: string): SQL {
    if (scope === "orders") {
        if (section === "inbox") return inbox(tenantId);

        const base = orderBase(tenantId);

        switch (section) {
            case "procurement": return and(base, inArray(movement.status, ["procurement", "offered", "declined"])) as SQL;
            case "booked": return and(base, eq(movement.status, "scheduled")) as SQL;
            case "in-transit": return and(base, eq(movement.status, "in-transit")) as SQL;
            case "delivered": return and(base, eq(movement.status, "delivered")) as SQL;
            case "history": return and(base, inArray(movement.status, ["closed", "cancelled"])) as SQL;
            default: return base;
        }
    }

    const base = tripBase(tenantId);

    switch (section) {
        case "planning": return and(base, eq(movement.status, "procurement")) as SQL;
        case "scheduled": return and(base, eq(movement.status, "scheduled")) as SQL;
        case "in-transit": return and(base, eq(movement.status, "in-transit")) as SQL;
        case "delivered": return and(base, eq(movement.status, "delivered")) as SQL;
        case "history": return and(base, inArray(movement.status, ["closed", "cancelled"])) as SQL;
        default: return base;
    }
}

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
                sell: sell && { amount: sell.total, currency: sell.currency },
                buy: buy && { amount: buy.total, currency: buy.currency },
                ownFleet: row.execution === "own-fleet",
                costs: totals,
            }),
            costs: totals,
        },
    };
}

const headline = (value: MoneyLeg | null) => (value ? { total: value.total, currency: value.currency } : null);

// ---------------------------------------------------------------------------
// Rows and details
// ---------------------------------------------------------------------------

const party = (id: string | null, fallback: string | null, names: Map<string, string>): MovementParty | null =>
    id ? { id, name: names.get(id) ?? null } : fallback ? { id: null, name: fallback } : null;

export function toMovementRow(
    row: Movement,
    role: MovementRole,
    ctx: { names: Map<string, string>; pings: PingState; trailId: string },
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
        driverName: row.driverName,
        truckPlate: row.truckPlate,
        payable: headline(money.payable),
        receivable: headline(money.receivable),
        isLinked: owner && row.executionMovementId !== null,
        lastPing: ctx.pings.last.get(ctx.trailId) ?? null,
        pingCount: ctx.pings.counts.get(ctx.trailId) ?? 0,
        version: row.version,
        createdAt: row.createdAt,
    };
}

/** Which papers a role may read: every side sees the load's own. */
const documentLegsFor = (role: MovementRole): readonly ("sell" | "buy" | null)[] =>
    role === "owner" ? ["sell", "buy", null] : role === "executor" ? ["buy", null] : ["sell", null];

/** Which trail lines a role may read. Money and costs are the owner's. */
const eventKindsFor = (role: MovementRole): readonly MovementEventKind[] =>
    role === "owner"
        ? ["status", "offer", "update", "money", "cost", "document", "note", "system"]
        : role === "executor"
            // The offer and its answer are between the two of them
            ? ["status", "offer", "system"]
            // A client follows the load, not how its transporter sourced it
            : ["status", "system"];

type DetailExtras = {
    names: Map<string, string>;
    pings: PingState;
    trailId: string;
    hasParent: boolean;
    executorOnPortal: boolean;
    costs: readonly CostRow[];
    documents: readonly MovementDocumentView[];
    events: readonly (Omit<MovementEventView, "action"> & { metadata: unknown; actorOrgId: string | null })[];
    orgRole: OrgRole;
};

export function toMovementDetail(row: Movement, role: MovementRole, extras: DetailExtras): MovementDetail {
    const owner = role === "owner";
    const money = projectMoney(row, role, owner ? extras.costs : []);
    const legs = documentLegsFor(role);
    const kinds = eventKindsFor(role);

    return {
        ...toMovementRow(row, role, extras),
        route: row.route,
        category: row.category,
        weight: num(row.weight),
        weightUnit: row.weightUnit,
        closedAt: row.closedAt,
        trackingEnabled: row.trackingEnabled,
        notes: owner ? row.notes : null,
        clientReference: role === "executor" ? null : row.clientReference,
        driverPhone: owner ? row.driverPhone : null,
        driverId: owner ? row.driverId : null,
        truckId: owner ? row.truckId : null,
        trailerId: owner ? row.trailerId : null,
        linkId: owner ? row.linkId : null,
        offeredAt: role === "client" ? null : row.offeredAt,
        respondedAt: role === "client" ? null : row.respondedAt,
        responseNote: role === "client" ? null : row.responseNote,
        hasParent: owner && extras.hasParent,
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
        documents: extras.documents.filter((document) => legs.includes(document.leg)),
        events: extras.events
            .filter((event) => kinds.includes(event.kind))
            .map((event) => ({
                id: event.id,
                kind: event.kind,
                fromStatus: event.fromStatus,
                toStatus: event.toStatus,
                // A note is its writer's: an offer's message is meant for the
                // executor, everything else stays with the owner
                note: owner || (role === "executor" && event.kind === "offer") ? event.note : null,
                action: readAction(event.metadata),
                actorName: event.actorName,
                createdAt: event.createdAt,
            })),
        permissions: permissionsFor(row, role, extras),
        updatedAt: row.updatedAt,
    };
}

function readAction(metadata: unknown): string | null {
    if (metadata && typeof metadata === "object" && "action" in metadata) {
        const action = (metadata as { action: unknown }).action;
        return typeof action === "string" ? action : null;
    }
    return null;
}

/**
 * What the caller may do now. Decided here, from the same functions the
 * doors enforce, so a button on the page is a promise the server keeps —
 * and it includes the member's own role in the company, since a button the
 * company could press but this member cannot is still a button that fails.
 */
function permissionsFor(row: Movement, role: MovementRole, extras: DetailExtras): MovementPermissions {
    const can = (resource: "trip" | "order" | "offer" | "document", action: string) =>
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
        canRecordPayment: false,
        canRequestLocation: false,
    };

    if (role !== "owner") return none;

    const partner = row.execution === "partner";
    const linked = row.executionMovementId !== null;
    const writeResource = partner ? "order" : "trip";
    const mayWrite = can(writeResource, "update");
    const shape = { execution: row.execution, status: row.status, linked, executorOnPortal: extras.executorOnPortal };
    const guards = {
        ...row,
        sellSettled: legSettled(row.sellTotal, row.sellSettlement),
        buySettled: !partner || legSettled(row.buyTotal, row.buySettlement),
    };

    return {
        transitions: mayWrite
            ? ownerTargets(shape).map((to) => {
                // A reason is typed in the dialog that takes the move, so it
                // is reported as a field to ask for, never as a blocker
                const blocker = transitionBlocker(guards, to, null);
                const needsNote = blocker === "NOTE_REQUIRED";

                return { to, blocker: needsNote ? transitionBlocker(guards, to, "noted") : blocker, needsNote };
            })
            : [],
        editable: mayWrite
            ? editableGroups({ ...shape, hasParent: extras.hasParent })
            : [],
        canOffer: partner && !linked && extras.executorOnPortal
            && (row.status === "procurement" || row.status === "declined") && can("order", "create"),
        canWithdraw: row.status === "offered" && can("order", "update"),
        canRespond: false,
        canConvert: can("order", "create") && (
            partner
                ? !linked && (row.status === "procurement" || row.status === "declined")
                : row.status === "procurement" || row.status === "scheduled"
        ),
        canManageCosts: !isTerminal(row.status) && can("trip", "update"),
        canManageDocuments: can("document", "upload"),
        canRecordPayment: row.status !== "cancelled" && (row.sellTotal !== null || (partner && row.buyTotal !== null))
            && can("order", "update"),
        canRequestLocation: row.status === "in-transit" && !linked && Boolean(row.driverPhone) && can("trip", "update"),
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
            createdAt: movementDocument.createdAt,
            deletedAt: movementDocument.deletedAt,
        })
        .from(movementDocument)
        .leftJoin(user, eq(user.id, movementDocument.uploadedBy))
        .where(eq(movementDocument.movementId, movementId))
        .orderBy(desc(movementDocument.createdAt));

    return rows
        .filter((row) => row.deletedAt === null)
        .map(({ deletedAt: _deleted, ...document }) => document);
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
