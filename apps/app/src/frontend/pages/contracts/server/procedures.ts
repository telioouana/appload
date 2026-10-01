import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { contract, contractAllocation, type Contract, type ContractAllocation } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { movement, type Movement } from "@workspace/db/movements";
import { organization, user } from "@workspace/db/users";
import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import { loadContract, roleOn, visibleContracts, type ContractRole } from "@workspace/domain/contracts/access";
import {
    addAllocation,
    createContract,
    removeAllocation,
    transitionContract,
    updateAllocation,
    updateContract,
} from "@workspace/domain/contracts/apply";
import { latestRate, toMzn } from "@workspace/domain/contracts/fx";
import { foldOrderMoney } from "@workspace/domain/contracts/money";
import { tripDefaultsFor, type TripDefaults } from "@workspace/domain/contracts/prefill";
import { commitmentValue, consumedValue } from "@workspace/domain/contracts/price";
import { allocationUsage, summarizeProgress, type AllocationUsage, type ContractProgress } from "@workspace/domain/contracts/progress";
import { acceptsTrips, derivedState } from "@workspace/domain/contracts/state";
import { isOnPortal } from "@workspace/domain/movements/link";
import { movementRef } from "@workspace/domain/movements/refs";
import { contractFilePath } from "@workspace/edgestore/path";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import {
    AddAllocationSchema,
    ContractInputSchema,
    SetContractFileSchema,
    TransitionContractSchema,
    TripDefaultsSchema,
    UpdateAllocationSchema,
    UpdateContractSchema,
} from "@/backend/schemas/contract";
import { loadNames, visibleMovements } from "@/frontend/pages/movements/server/projection";
import {
    CONTRACT_SORTS,
    CONTRACT_STATES,
    CONTRACT_TABS,
    PAGE_SIZES,
    type AllocationView,
    type ContractDetail,
    type ContractMoneyLine,
    type ContractRow,
    type ContractStats,
    type ContractTripRow,
    type PagedResult,
} from "@/frontend/pages/contracts/types";

type Db = typeof Database;

const ListInput = z.object({
    tab: z.enum(CONTRACT_TABS).default("own"),
    state: z.enum(CONTRACT_STATES).optional(),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(CONTRACT_SORTS).default("newest"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** "own" is the company's books; "partners" every contract another company named it on; "all" both. */
const tabPredicate = (tab: "own" | "partners" | "all", tenantId: string): SQL | undefined =>
    tab === "all" ? undefined : tab === "own" ? eq(contract.organizationId, tenantId) : sql`${contract.organizationId} <> ${tenantId}`;

function searchWhere(term: string): SQL {
    const pattern = `%${escapeLike(term)}%`;
    return or(
        ilike(contract.reference, pattern),
        ilike(contract.clientName, pattern),
        ilike(contract.clientReference, pattern),
        sql`exists (select 1 from ${organization} o where o.id = ${contract.clientOrgId} and o.name ilike ${pattern})`,
        sql`exists (select 1 from ${organization} o where o.id = ${contract.organizationId} and o.name ilike ${pattern})`,
    ) as SQL;
}

/**
 * The company's whole visible set, with every share and the trips under
 * them read in two queries. Contracts are few per company, and their state
 * is derived, so the list filters, sorts and pages in memory.
 */
async function visibleSet(db: Db, tenantId: string, tab: "own" | "partners" | "all", search?: string) {
    const rows = await db
        .select()
        .from(contract)
        // Rentals (days) have their own list and page
        .where(and(sql`${contract.basis} <> 'days'`, visibleContracts(tenantId), tabPredicate(tab, tenantId), search ? searchWhere(search) : undefined))
        .orderBy(desc(contract.createdAt));

    const allocations = rows.length === 0 ? [] : await db
        .select()
        .from(contractAllocation)
        .where(inArray(contractAllocation.contractId, rows.map((row) => row.id)))
        .orderBy(asc(contractAllocation.createdAt));

    const usage = await allocationUsage(db, allocations.map((row) => row.id));
    const names = await loadNames(db, [
        ...rows.map((row) => row.organizationId),
        ...rows.map((row) => row.clientOrgId),
        ...allocations.map((row) => row.carrierOrgId),
    ]);

    const byContract = new Map<string, ContractAllocation[]>();
    for (const allocation of allocations) {
        const list = byContract.get(allocation.contractId) ?? [];
        list.push(allocation);
        byContract.set(allocation.contractId, list);
    }

    return { rows, byContract, usage, names };
}

/**
 * A carrier's reading of a contract is its own share: what the owner
 * committed to other transporters is not its business, and neither are the
 * totals. Owner and client read the whole.
 */
function shares(all: ContractAllocation[], role: ContractRole, tenantId: string): ContractAllocation[] {
    if (role === "carrier") return all.filter((row) => row.carrierOrgId === tenantId);
    if (role === "client") return [];
    return all;
}

function toRow(
    row: Contract,
    all: ContractAllocation[],
    role: ContractRole,
    tenantId: string,
    usage: Map<string, AllocationUsage>,
    names: Map<string, string>,
): { view: ContractRow; progress: ContractProgress; mine: ContractAllocation[] } {
    const mine = shares(all, role, tenantId);
    // The client's progress is the whole contract's, read over every share
    const progress = summarizeProgress(row, role === "client" ? all : mine, usage);
    const derived = derivedState(row, role === "carrier" ? progress : summarizeProgress(row, all, usage));
    // A draft naming this company is a proposal waiting on its answer
    const state = derived === "draft" && role === "client" ? "proposed" : derived;

    return {
        view: {
            id: row.id,
            ref: row.reference ?? "—",
            status: row.status,
            state,
            basis: row.basis,
            role,
            owner: { id: row.organizationId, name: names.get(row.organizationId) ?? "—" },
            client: row.clientOrgId || row.clientName
                ? { id: row.clientOrgId, name: row.clientOrgId ? names.get(row.clientOrgId) ?? null : row.clientName }
                : null,
            origin: row.origin,
            destination: row.destination,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            committedQty: row.committedQty === null ? null : Number(row.committedQty),
            weightUnit: row.weightUnit,
            currency: row.currency,
            progress: {
                consumed: progress.consumed,
                delivered: progress.delivered,
                remaining: progress.remaining,
                trips: progress.trips,
            },
            allocationCount: role === "client" ? all.length : mine.length,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        },
        progress,
        mine,
    };
}

/**
 * What a contract is worth to whoever is reading, committed and drawn down:
 * a client pays the sell price, a carrier is paid its share's buy price, the
 * owner earns the sell price when there is one and pays its shares otherwise.
 * Null where the price cannot value the quantity, or there is no price.
 */
// ponytail: an owner that sells and subcontracts reads its revenue only; add a cost column when a transporter asks for its margin here
function moneyOf(row: Contract, mine: ContractAllocation[], role: ContractRole, progress: ContractProgress) {
    const committedQty = row.committedQty === null ? null : Number(row.committedQty);
    const whole = (model: Contract["sellPrice"]) => [{
        committed: commitmentValue(model, row.basis, committedQty),
        drawn: consumedValue(model, row.basis, committedQty, progress.consumed),
    }];
    const shares = () => mine.map((share) => {
        const qty = share.shareQty === null ? null : Number(share.shareQty);
        return {
            committed: commitmentValue(share.buyPrice, row.basis, qty),
            drawn: consumedValue(share.buyPrice, row.basis, qty, progress.byAllocation.get(share.id)?.consumed ?? 0),
        };
    });

    if (role === "client") return whole(row.sellPrice);
    if (role === "carrier") return shares();
    return row.sellPrice ? whole(row.sellPrice) : shares();
}

/**
 * Every multi-trip order the company can read, the way the orders list
 * carries it among the trips: the row, who provides the trucks on it (the
 * reader's own shares — a client is not told the carriers), and the one
 * figure the reader follows, drawn down so far on its side of the deal.
 */
export type StandingOrderRow = {
    view: ContractRow;
    providers: Array<{ id: string | null; name: string | null }>;
    money: { leg: "sell" | "buy"; amount: number } | null;
};

export async function standingOrderRows(db: Db, tenantId: string): Promise<StandingOrderRow[]> {
    const { rows, byContract, usage, names } = await visibleSet(db, tenantId, "all");

    return rows.flatMap((row) => {
        const all = byContract.get(row.id) ?? [];
        const role = roleOn(row, all, tenantId);
        if (!role) return [];

        const { view, progress, mine } = toRow(row, all, role, tenantId, usage, names);
        const drawn = moneyOf(row, mine, role, progress).map((leg) => leg.drawn).filter((value): value is number => value !== null);
        // A client pays, a carrier is paid, the owner earns its price when it has one and pays its shares otherwise
        const leg = role === "client" ? "buy" : role === "carrier" ? "sell" : row.sellPrice ? "sell" : "buy";

        return [{
            view,
            providers: mine
                .filter((share) => share.carrierOrgId || share.carrierName)
                .map((share) => ({ id: share.carrierOrgId, name: share.carrierOrgId ? names.get(share.carrierOrgId) ?? null : share.carrierName })),
            money: drawn.length === 0 ? null : { leg, amount: drawn.reduce((sum, value) => sum + value, 0) },
        }];
    });
}

const orderings: Record<"newest" | "period" | "reference", (a: ContractRow, b: ContractRow) => number> = {
    newest: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    period: (a, b) => a.startsOn.localeCompare(b.startsOn),
    reference: (a, b) => a.ref.localeCompare(b.ref),
};

async function rigsFor(db: Db, allocations: ContractAllocation[]) {
    const truckIds = allocations.map((row) => row.truckId).filter((id): id is string => Boolean(id));
    const driverIds = allocations.map((row) => row.driverId).filter((id): id is string => Boolean(id));

    const [trucks, drivers] = await Promise.all([
        truckIds.length === 0 ? [] : db.select({ id: truck.id, plate: truck.regPlate }).from(truck).where(inArray(truck.id, truckIds)),
        driverIds.length === 0 ? [] : db
            .select({ id: driver.id, name: user.name })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(inArray(driver.id, driverIds)),
    ]);

    return {
        trucks: new Map(trucks.map((row) => [row.id, row])),
        drivers: new Map(drivers.map((row) => [row.id, row])),
    };
}

/**
 * What a trip is worth to whoever is reading, and where its settlement
 * stands: the buy leg on the owner's partner row (what it pays out) and on
 * a row somebody else owns (what the reader is paid or pays), the sell leg
 * on the reader's own row otherwise.
 */
function tripTotal(row: Movement, tenantId: string): Pick<ContractTripRow, "total" | "currency" | "settlement" | "settled" | "canRecordPayment"> {
    const owned = row.organizationId === tenantId;
    const buy = (owned && row.execution === "partner") || !owned;
    const total = buy ? row.buyTotal : row.sellTotal;
    return {
        total: total === null ? null : Number(total),
        currency: buy ? row.buyCurrency : row.sellCurrency,
        settlement: total === null ? null : buy ? row.buySettlement : row.sellSettlement,
        settled: total === null ? null : Number(buy ? row.buyPaidAmount : row.sellReceivedAmount),
        canRecordPayment: owned && total !== null && row.status !== "cancelled",
    };
}

async function detailOf(db: Db, id: string, tenantId: string, orgRole: OrgRole): Promise<ContractDetail> {
    const { row, allocations: mine, role } = await loadContract(db, id, tenantId);
    // The owner's whole set decides the state even when the reader sees a slice
    const all = role === "owner" ? mine : await db.select().from(contractAllocation).where(eq(contractAllocation.contractId, row.id));
    const usage = await allocationUsage(db, all.map((share) => share.id));
    const names = await loadNames(db, [row.organizationId, row.clientOrgId, ...all.map((share) => share.carrierOrgId)]);
    const { view, progress, mine: visible } = toRow(row, all, role, tenantId, usage, names);
    const rigs = await rigsFor(db, visible);

    // A client reads no shares but every trip filed for it: the owner's rows
    // naming it are its own to see (visibleMovements), and the order's money
    // and payments live on them
    const under = role === "client" ? all : visible;
    const trips = under.length === 0 ? [] : await db
        .select()
        .from(movement)
        .where(and(inArray(movement.contractAllocationId, under.map((share) => share.id)), visibleMovements(tenantId)))
        .orderBy(desc(movement.createdAt));
    const money = foldOrderMoney({
        role,
        tenantId,
        contract: { basis: row.basis, committedQty: row.committedQty, currency: row.currency, sellPrice: row.sellPrice },
        shares: visible,
        trips,
    });

    const canManage = role === "owner" && isOrgAuthorized(orgRole, "contract", ["update"]);
    const open = row.status !== "closed";
    // A draft naming a client on the portal is a proposal: the client accepts it
    const proposal = row.status === "draft" && row.clientOrgId !== null && await isOnPortal(db, row.clientOrgId);
    const canAnswer = role === "client" && proposal && isOrgAuthorized(orgRole, "contract", ["update"]);

    return {
        ...view,
        clientReference: role === "carrier" ? null : row.clientReference,
        fiscalRegime: row.fiscalRegime,
        sellPrice: role === "carrier" ? null : row.sellPrice,
        fileUrl: role === "carrier" ? null : row.fileUrl,
        fileName: role === "carrier" ? null : row.fileName,
        notes: role === "owner" ? row.notes : null,
        version: row.version,
        allocations: visible.map((share): AllocationView => ({
            id: share.id,
            carrier: share.carrierOrgId || share.carrierName
                ? { id: share.carrierOrgId, name: share.carrierOrgId ? names.get(share.carrierOrgId) ?? null : share.carrierName }
                : null,
            shareQty: share.shareQty === null ? null : Number(share.shareQty),
            buyPrice: share.buyPrice,
            truck: share.truckId ? rigs.trucks.get(share.truckId) ?? null : null,
            driver: share.driverId ? rigs.drivers.get(share.driverId) ?? null : null,
            truckPlate: share.truckPlate,
            notes: role === "owner" ? share.notes : null,
            progress: progress.byAllocation.get(share.id) ?? { share: null, consumed: 0, delivered: 0, remaining: null, trips: 0 },
        })),
        trips: trips.map((trip): ContractTripRow => ({
            id: trip.id,
            ref: movementRef(trip),
            status: trip.status,
            execution: trip.execution,
            allocationId: trip.contractAllocationId ?? "",
            expectedLoadingDate: trip.expectedLoadingDate,
            weight: trip.weight === null ? null : Number(trip.weight),
            weightUnit: trip.weightUnit,
            ...tripTotal(trip, tenantId),
            createdAt: trip.createdAt,
        })),
        money,
        permissions: {
            canEdit: canManage && open,
            canAllocate: canManage && open,
            canActivate: canManage && row.status === "draft" && !proposal,
            canAccept: canAnswer,
            canDecline: canAnswer,
            canClose: canManage && open,
            canFileTrip: role !== "client" && acceptsTrips(view.state) && visible.length > 0
                && isOrgAuthorized(orgRole, "trip", ["create"]),
        },
    };
}

const actorOf = (ctx: { tenant: { organizationId: string; userId: string } }) => ({
    organizationId: ctx.tenant.organizationId,
    userId: ctx.tenant.userId,
});

export const contractsRouter = createTRPCRouter({
    list: tenantProcedure
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<ContractRow>> => {
            const tenantId = ctx.tenant.organizationId;
            const { rows, byContract, usage, names } = await visibleSet(ctx.db, tenantId, input.tab, input.search);

            let items = rows.flatMap((row) => {
                const all = byContract.get(row.id) ?? [];
                const role = roleOn(row, all, tenantId);
                return role ? [toRow(row, all, role, tenantId, usage, names).view] : [];
            });

            if (input.state) items = items.filter((item) => item.state === input.state);
            items.sort(orderings[input.sort]);
            if (input.dir === "desc") items.reverse();

            const start = (input.page - 1) * input.pageSize;

            return { items: items.slice(start, start + input.pageSize), total: items.length, page: input.page, pageSize: input.pageSize };
        }),

    /** How many contracts stand in each state, for the tabs — the same set the list reads. */
    stats: tenantProcedure
        .input(z.object({ tab: z.enum(CONTRACT_TABS).default("own") }))
        .query(async ({ ctx, input }): Promise<ContractStats> => {
            const tenantId = ctx.tenant.organizationId;
            const { rows, byContract, usage, names } = await visibleSet(ctx.db, tenantId, input.tab);
            const byState: ContractStats["byState"] = { draft: 0, proposed: 0, active: 0, exhausted: 0, expired: 0, closed: 0 };
            const lines = new Map<ContractMoneyLine["currency"], ContractMoneyLine>();
            const emptyLine = (currency: ContractMoneyLine["currency"]): ContractMoneyLine =>
                ({ currency, committed: 0, drawn: 0, remaining: 0, received: 0, receivable: 0, paid: 0, outstanding: 0 });

            // Every trip under the tab's standing orders, once, for what has moved on them
            const liveIds = rows.filter((row) => row.status !== "closed").flatMap((row) => (byContract.get(row.id) ?? []).map((share) => share.id));
            const trips = liveIds.length === 0 ? [] : await ctx.db
                .select()
                .from(movement)
                .where(and(inArray(movement.contractAllocationId, liveIds), visibleMovements(tenantId)));
            const shareContract = new Map(rows.flatMap((row) => (byContract.get(row.id) ?? []).map((share) => [share.id, row.id] as const)));

            for (const row of rows) {
                const all = byContract.get(row.id) ?? [];
                const role = roleOn(row, all, tenantId);
                if (!role) continue;

                const { view, progress, mine } = toRow(row, all, role, tenantId, usage, names);
                byState[view.state] += 1;
                // A closed contract's money is history; the strip is what stands
                if (row.status === "closed") continue;

                const line = lines.get(row.currency) ?? emptyLine(row.currency);
                for (const { committed, drawn } of moneyOf(row, mine, role, progress)) {
                    line.committed += committed ?? 0;
                    line.drawn += drawn ?? 0;
                    // An open commitment has nothing left to count down from
                    line.remaining += committed === null ? 0 : committed - (drawn ?? 0);
                }
                lines.set(row.currency, line);

                const folded = foldOrderMoney({
                    role,
                    tenantId,
                    contract: { basis: row.basis, committedQty: row.committedQty, currency: row.currency, sellPrice: row.sellPrice },
                    shares: mine,
                    trips: trips.filter((trip) => trip.contractAllocationId !== null && shareContract.get(trip.contractAllocationId) === row.id),
                });
                for (const moved of folded.lines) {
                    const target = lines.get(moved.currency) ?? emptyLine(moved.currency);
                    target.received += moved.received;
                    target.receivable += moved.receivable;
                    target.paid += moved.paid;
                    target.outstanding += moved.outstanding;
                    lines.set(moved.currency, target);
                }
            }

            const rate = lines.size > 0 ? await latestRate(ctx.db) : null;
            const total: ContractStats["money"]["total"] = rate ? { ...emptyLine("MZN"), rateDay: rate.day } : null;
            for (const line of lines.values()) {
                if (!total || !rate) break;
                for (const key of ["committed", "drawn", "remaining", "received", "receivable", "paid", "outstanding"] as const) {
                    total[key] += toMzn(line.currency, line[key], rate);
                }
            }

            return { total: rows.length, byState, money: { lines: [...lines.values()], total } };
        }),

    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(({ ctx, input }) => detailOf(ctx.db, input.id, ctx.tenant.organizationId, ctx.tenant.role)),

    create: authorizedTenantProcedure("contract", ["create"])
        .input(ContractInputSchema)
        .mutation(async ({ ctx, input }) => {
            const row = await createContract(ctx.db, actorOf(ctx), input);
            return { id: row.id, ref: row.reference ?? "—" };
        }),

    update: authorizedTenantProcedure("contract", ["update"])
        .input(UpdateContractSchema)
        .mutation(async ({ ctx, input }) => {
            const row = await updateContract(ctx.db, actorOf(ctx), input);
            return { id: row.id, version: row.version };
        }),

    transition: authorizedTenantProcedure("contract", ["update"])
        .input(TransitionContractSchema)
        .mutation(async ({ ctx, input }) => {
            const row = await transitionContract(ctx.db, actorOf(ctx), input);
            return { id: row.id, status: row.status, version: row.version };
        }),

    /** The signed paper: uploaded by the client, only its address is kept here. Null takes it off. */
    setFile: authorizedTenantProcedure("contract", ["update"])
        .input(SetContractFileSchema)
        .mutation(async ({ ctx, input }) => {
            // Only a file uploaded against this contract's own folder can be its paper
            if (input.url) {
                let path = "";
                try {
                    path = decodeURIComponent(new URL(input.url).pathname);
                } catch {
                    path = "";
                }
                if (!path.includes(`/${contractFilePath(input.id)}/`)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
                }
            }

            const [row] = await ctx.db
                .update(contract)
                .set({ fileUrl: input.url, fileName: input.url ? input.name : null, version: input.expectedVersion + 1 })
                .where(and(
                    eq(contract.id, input.id),
                    eq(contract.organizationId, ctx.tenant.organizationId),
                    eq(contract.version, input.expectedVersion),
                ))
                .returning({ id: contract.id, version: contract.version });

            if (!row) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            return row;
        }),

    allocations: createTRPCRouter({
        add: authorizedTenantProcedure("contract", ["update"])
            .input(AddAllocationSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await addAllocation(ctx.db, actorOf(ctx), input);
                return { id: row.id };
            }),
        update: authorizedTenantProcedure("contract", ["update"])
            .input(UpdateAllocationSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await updateAllocation(ctx.db, actorOf(ctx), input);
                return { id: row.id };
            }),
        remove: authorizedTenantProcedure("contract", ["update"])
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }) => {
                await removeAllocation(ctx.db, actorOf(ctx), input.id);
                return { id: input.id };
            }),
    }),

    /** What a load filed under a share starts out as — every field an editable default. */
    tripDefaults: tenantProcedure
        .input(TripDefaultsSchema)
        .query(({ ctx, input }): Promise<TripDefaults> =>
            tripDefaultsFor(ctx.db, ctx.tenant.organizationId, input.allocationId, {
                weight: input.weight ?? null,
                weightUnit: input.weightUnit ?? null,
            })),
});
