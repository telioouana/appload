import "server-only";

import type { MoneyView } from "@workspace/auth/organization-permissions";
import type { db as Database } from "@workspace/db/db";
import type { ContractRole } from "@workspace/domain/contracts/access";
import type { ContractState } from "@workspace/domain/contracts/state";
import type { Currency } from "@workspace/domain/movements/money";

import { standingOrderRows } from "@/frontend/pages/contracts/server/procedures";
import { rentalOrderRows } from "@/frontend/pages/rentals/server/procedures";
import type {
    MovementKind,
    MovementRow,
    MovementScope,
    MovementSection,
    MovementSort,
    MovementStats,
    MovementStatus,
    PagedResult,
} from "@/frontend/pages/movements/types";

type Db = typeof Database;

/**
 * The standing orders — multi-trip orders and rentals, both `contract` rows —
 * as rows of the orders list, among the trips. They are few per company and
 * their state is derived, so they are read whole, filtered here the way the
 * trips are filtered in SQL, and merged into the trips' page by sort key.
 * The strip and the tiles keep counting trips; a standing order's row
 * carries its own figure.
 */

type Party = { id: string | null; name: string | null };

type Standing = {
    id: string;
    ref: string;
    kind: Exclude<MovementKind, "trip">;
    state: ContractState;
    role: ContractRole;
    owner: Party;
    client: Party | null;
    providers: Party[];
    origin: MovementRow["origin"] | null;
    destination: MovementRow["origin"] | null;
    startsOn: string;
    endsOn: string | null;
    currency: Currency;
    money: { leg: "sell" | "buy"; amount: number } | null;
    done: number;
    of: number | null;
    unit: "trip" | "ton" | "day";
    trucks: string[];
    disputed: number;
    createdAt: Date;
};

const NOWHERE = { address: "", placeId: "", country: "", state: "" };

/** A day of the period, read at noon so no offset moves it to the eve. */
const dayOf = (iso: string | null): Date | null => (iso ? new Date(`${iso}T12:00:00`) : null);

/**
 * Which tab a standing order is under, by the trips' own rule (scopeOf): a
 * transporter's share and an owner's own-fleet work are its trucks;
 * everything placed with a partner, or asked of the company, is the partners'.
 */
const scopeOfStanding = (row: Standing): MovementScope =>
    row.role === "carrier" || (row.role === "owner" && row.providers.length === 0) ? "trips" : "orders";

/** The section a standing order sits in: waiting to start, running, or over. Never "disputes", which cuts across. */
const sectionOfState = (state: ContractState): MovementSection =>
    state === "draft" || state === "proposed" ? "procurement"
        : state === "active" || state === "exhausted" ? "in-progress"
            : "history";

/**
 * The trip status a standing order's row stands in for. The row's cells read
 * `order.state`; this only keeps the row's shape, and matches a status tab
 * where the two words mean the same wait: a draft is procurement, a proposal
 * a prospect, a closed order closed. "booked" is the stand-in for a running
 * one and is never matched as a tab.
 */
const statusOfState = (state: ContractState): MovementStatus =>
    state === "draft" ? "procurement"
        : state === "proposed" ? "prospect"
            : state === "expired" || state === "closed" ? "closed"
                : "booked";

const TAB_STATUSES: readonly MovementStatus[] = ["procurement", "prospect", "closed"];

async function readStanding(db: Db, tenantId: string): Promise<Standing[]> {
    const [orders, rentals] = await Promise.all([standingOrderRows(db, tenantId), rentalOrderRows(db, tenantId)]);

    return [
        ...orders.map(({ view, providers, money }): Standing => ({
            id: view.id,
            ref: view.ref,
            kind: "multi",
            state: view.state,
            role: view.role,
            owner: view.owner,
            client: view.client,
            providers,
            origin: view.origin,
            destination: view.destination,
            startsOn: view.startsOn,
            endsOn: view.endsOn,
            currency: view.currency,
            money,
            done: view.progress.consumed,
            of: view.committedQty,
            unit: view.basis === "weight" ? "ton" : "trip",
            trucks: [],
            disputed: 0,
            createdAt: view.createdAt,
        })),
        ...rentals.map(({ view, providers, money }): Standing => ({
            id: view.id,
            ref: view.ref,
            kind: "rental",
            state: view.state,
            role: view.role,
            owner: view.owner,
            client: view.client,
            providers,
            origin: view.site,
            destination: null,
            startsOn: view.startsOn,
            endsOn: view.endsOn,
            currency: view.currency,
            money,
            done: view.billableDays,
            of: view.periodDays,
            unit: "day",
            trucks: view.trucks,
            disputed: view.attention.disputed,
            createdAt: view.createdAt,
        })),
    ];
}

function toRow(row: Standing, view: MoneyView): MovementRow {
    // What the order has drawn is its price at work: hidden from a reader without `price:read`
    const amount = row.money && view !== "none" ? { total: row.money.amount, currency: row.currency } : null;
    // One provider is the partner on the row; several read as a count in the cell
    const provider = row.providers.length === 1 ? row.providers[0]! : null;

    return {
        id: row.id,
        ref: row.ref,
        kind: row.kind,
        order: { state: row.state, done: row.done, of: row.of, unit: row.unit, trucks: row.trucks.length, providers: row.providers.length },
        apploadOrderId: null,
        execution: row.providers.length === 0 ? "own-fleet" : "partner",
        status: statusOfState(row.state),
        role: row.role === "carrier" ? "executor" : row.role,
        origin: row.origin ?? NOWHERE,
        destination: row.destination ?? NOWHERE,
        cargoDescription: null,
        expectedLoadingDate: dayOf(row.startsOn),
        expectedDeliveryAt: dayOf(row.endsOn),
        startedAt: null,
        deliveredAt: null,
        owner: row.role === "owner" ? null : row.owner,
        client: row.role === "owner" ? row.client : null,
        carrier: row.role === "owner" ? (provider ?? (row.providers.length > 1 ? { id: null, name: null } : null)) : null,
        driverName: null,
        truckPlate: row.trucks.length === 1 ? row.trucks[0]! : null,
        payable: row.money?.leg === "buy" ? amount : null,
        receivable: row.money?.leg === "sell" ? amount : null,
        isLinked: false,
        quoteRequested: false,
        quotes: null,
        inDispute: row.disputed > 0,
        offRoute: false,
        silent: false,
        flags: [],
        lastPing: null,
        pingCount: 0,
        parent: null,
        // A standing order is never edited from its row, so its version is not carried
        version: 0,
        createdAt: row.createdAt,
    };
}

export type StandingFilter = {
    scope: MovementScope;
    section: MovementSection;
    status?: MovementStatus;
    search?: string;
    silent?: true;
    disputed?: true;
    offRoute?: true;
    hasCosts?: true;
    partner?: string;
    contractId?: string;
    month?: number;
    from?: string;
    to?: string;
};

function matches(row: Standing, input: StandingFilter): boolean {
    if (scopeOfStanding(row) !== input.scope) return false;
    if (input.section === "disputes" ? row.disputed === 0 : input.section !== "all" && sectionOfState(row.state) !== input.section) return false;
    if (input.status && !(TAB_STATUSES.includes(input.status) && statusOfState(row.state) === input.status)) return false;
    // Positions, costs and the trips under one order are the trips' alone
    if (input.silent || input.offRoute || input.hasCosts || input.contractId) return false;
    if (input.disputed && row.disputed === 0) return false;

    if (input.partner) {
        const ids = [row.owner.id, row.client?.id ?? null, ...row.providers.map((party) => party.id)];
        if (!ids.includes(input.partner)) return false;
    }

    if (input.search) {
        const term = input.search.toLowerCase();
        const words = [row.ref, row.owner.name, row.client?.name, ...row.providers.map((party) => party.name), ...row.trucks];
        if (!words.some((word) => word?.toLowerCase().includes(term))) return false;
    }

    if (input.from && row.startsOn < input.from) return false;
    if (input.to && row.startsOn > input.to) return false;
    if (!input.from && !input.to && input.month) {
        const year = new Date().getFullYear();
        const start = `${year}-${String(input.month).padStart(2, "0")}-01`;
        const end = input.month === 12 ? `${year + 1}-01-01` : `${year}-${String(input.month + 1).padStart(2, "0")}-01`;
        if (row.startsOn < start || row.startsOn >= end) return false;
    }

    return true;
}

/** The standing orders a list input lets through, as rows. */
export async function standingOrders(db: Db, tenantId: string, input: StandingFilter, view: MoneyView): Promise<MovementRow[]> {
    const rows = await readStanding(db, tenantId);
    return rows.filter((row) => matches(row, input)).map((row) => toRow(row, view));
}

/** How many standing orders each section and status tab of a scope holds, to add to the trips' counts. */
export async function standingCounts(db: Db, tenantId: string, scope: MovementScope): Promise<Pick<MovementStats, "bySection" | "byStatus">> {
    const rows = (await readStanding(db, tenantId)).filter((row) => scopeOfStanding(row) === scope);
    const bySection: MovementStats["bySection"] = {};
    const byStatus: MovementStats["byStatus"] = {};
    const add = <K extends string>(into: Partial<Record<K, number>>, key: K) => { into[key] = (into[key] ?? 0) + 1; };

    for (const row of rows) {
        add(bySection, "all");
        add(bySection, sectionOfState(row.state));
        if (row.disputed > 0) add(bySection, "disputes");
        const status = statusOfState(row.state);
        if (TAB_STATUSES.includes(status)) add(byStatus, status);
    }

    return { bySection, byStatus };
}

/**
 * One page of the trips and the standing orders together, ordered by the
 * list's sort key. The trips come paged from SQL; the standing orders are
 * all in hand. A window of trips wide enough for any of them to land on the
 * page is fetched (`windowFor`), and every row's place in the merged order
 * is its place among its own kind plus the rows of the other kind before it.
 * Nulls sort last whichever way the list runs, as the SQL does.
 */
export function windowFor(input: { page: number; pageSize: number }, standingCount: number) {
    const offset = (input.page - 1) * input.pageSize;
    return { offset: Math.max(0, offset - standingCount), limit: input.pageSize + standingCount };
}

export function mergePage(args: {
    window: MovementRow[];
    windowOffset: number;
    movementTotal: number;
    standing: MovementRow[];
    sort: MovementSort;
    dir: "asc" | "desc";
    page: number;
    pageSize: number;
}): PagedResult<MovementRow> {
    const { window, windowOffset, standing, sort, dir, page, pageSize } = args;
    const total = args.movementTotal + standing.length;

    if (standing.length === 0) return { items: window, total, page, pageSize };

    const key = (row: MovementRow) =>
        sort === "loading" ? row.expectedLoadingDate : sort === "delivery" ? row.expectedDeliveryAt : row.createdAt;
    const compare = (a: MovementRow, b: MovementRow) => {
        const ka = key(a);
        const kb = key(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        const delta = ka.getTime() - kb.getTime();
        return dir === "desc" ? -delta : delta;
    };

    const ordered = [...standing].sort((a, b) => compare(a, b) || b.createdAt.getTime() - a.createdAt.getTime());
    const offset = (page - 1) * pageSize;
    const placed: Array<{ at: number; row: MovementRow }> = [];

    window.forEach((row, w) => {
        placed.push({ at: windowOffset + w + ordered.filter((other) => compare(other, row) < 0).length, row });
    });

    ordered.forEach((row, r) => {
        // A standing order ahead of a window that does not start at the top
        // has trips before it we did not fetch; it lies before this page
        if (windowOffset > 0 && window.length > 0 && compare(row, window[0]!) < 0) return;
        placed.push({ at: r + windowOffset + window.filter((other) => compare(other, row) <= 0).length, row });
    });

    const items = placed
        .filter(({ at }) => at >= offset && at < offset + pageSize)
        .sort((a, b) => a.at - b.at)
        .map(({ row }) => row);

    return { items, total, page, pageSize };
}
