import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { contract, contractAllocation, type Contract, type ContractAllocation } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { contractPayment, type RentalDay } from "@workspace/db/rentals";
import { organization, user } from "@workspace/db/users";
import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import { loadContract, roleOn, visibleContracts, type ContractRole } from "@workspace/domain/contracts/access";
import { transitionContract } from "@workspace/domain/contracts/apply";
import { todayInMaputo } from "@workspace/domain/contracts/price";
import { derivedState } from "@workspace/domain/contracts/state";
import { addLine, createRental, endLine, removeLine, updateRental } from "@workspace/domain/rentals/apply";
import { lineBilling, lineDays, monthlyStatement, projectedDays, type PerDay } from "@workspace/domain/rentals/billing";
import { silentLines } from "@workspace/domain/rentals/checkin";
import { disputeDay, loadLog, markDay, settleDispute } from "@workspace/domain/rentals/log";
import { loadPayments, recordRentalPayment } from "@workspace/domain/rentals/payments";
import { isOnPortal } from "@workspace/domain/movements/link";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import {
    AddLineSchema,
    CreateRentalSchema,
    DisputeDaySchema,
    EndLineSchema,
    MarkDaySchema,
    RecordRentalPaymentSchema,
    SettleDisputeSchema,
    UpdateRentalSchema,
} from "@/backend/schemas/rental";
import { TransitionContractSchema } from "@/backend/schemas/contract";
import { loadNames } from "@/frontend/pages/movements/server/projection";
import {
    PAGE_SIZES,
    RENTAL_SORTS,
    RENTAL_STATES,
    RENTAL_TABS,
    type PagedResult,
    type RentalDetail,
    type RentalLineView,
    type RentalMoneyLine,
    type RentalRow,
    type RentalStats,
} from "@/frontend/pages/rentals/types";

type Db = typeof Database;

const ListInput = z.object({
    tab: z.enum(RENTAL_TABS).default("own"),
    state: z.enum(RENTAL_STATES).optional(),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(RENTAL_SORTS).default("newest"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const perDay = (model: Contract["sellPrice"]): PerDay | null => (model?.model === "per-day" ? model : null);
const round = (value: number) => Math.round(value * 100) / 100;

const tabPredicate = (tab: "own" | "partners" | "all", tenantId: string): SQL | undefined =>
    tab === "all" ? undefined : tab === "own" ? eq(contract.organizationId, tenantId) : sql`${contract.organizationId} <> ${tenantId}`;

function searchWhere(term: string): SQL {
    const pattern = `%${escapeLike(term)}%`;
    return or(
        ilike(contract.reference, pattern),
        ilike(contract.clientName, pattern),
        sql`exists (select 1 from ${organization} o where o.id = ${contract.clientOrgId} and o.name ilike ${pattern})`,
        sql`exists (select 1 from ${organization} o where o.id = ${contract.organizationId} and o.name ilike ${pattern})`,
        sql`exists (select 1 from ${contractAllocation} a join ${truck} t on t.id = a.truck_id where a.contract_id = ${contract.id} and t.reg_plate ilike ${pattern})`,
    ) as SQL;
}

/** The lines the reader may see: all for the owner and the client, its own for a provider. */
const linesFor = (all: ContractAllocation[], role: ContractRole, tenantId: string) =>
    role === "carrier" ? all.filter((line) => line.carrierOrgId === tenantId) : all;

/**
 * Everything a rental page or row is read from, for a set of orders: the
 * lines, their rigs, their logs, who was silent today and the payments.
 * Rentals are few per company; the arithmetic is done in memory.
 */
async function hydrate(db: Db, rows: Contract[]) {
    const ids = rows.map((row) => row.id);
    const allocations = ids.length === 0 ? [] : await db
        .select()
        .from(contractAllocation)
        .where(inArray(contractAllocation.contractId, ids))
        .orderBy(asc(contractAllocation.createdAt));

    const today = todayInMaputo();
    const lineIds = allocations.map((line) => line.id);
    const [log, silent, payments, names, trucks, drivers] = await Promise.all([
        loadLog(db, lineIds),
        silentLines(db, lineIds, today),
        ids.length === 0 ? [] : db.select().from(contractPayment).where(inArray(contractPayment.contractId, ids)).orderBy(desc(contractPayment.paidAt)),
        loadNames(db, [...rows.flatMap((row) => [row.organizationId, row.clientOrgId]), ...allocations.map((line) => line.carrierOrgId)]),
        rigs(db, allocations.map((line) => line.truckId)),
        people(db, allocations.map((line) => line.driverId)),
    ]);

    const byContract = new Map<string, ContractAllocation[]>();
    for (const line of allocations) byContract.set(line.contractId, [...(byContract.get(line.contractId) ?? []), line]);
    const logByLine = new Map<string, RentalDay[]>();
    for (const entry of log) logByLine.set(entry.allocationId, [...(logByLine.get(entry.allocationId) ?? []), entry]);

    return { today, byContract, logByLine, silent, payments, names, trucks, drivers };
}

type Hydrated = Awaited<ReturnType<typeof hydrate>>;

async function rigs(db: Db, truckIds: (string | null)[]) {
    const ids = [...new Set(truckIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map<string, string>();
    const rows = await db.select({ id: truck.id, plate: truck.regPlate }).from(truck).where(inArray(truck.id, ids));
    return new Map(rows.map((row) => [row.id, row.plate]));
}

async function people(db: Db, driverIds: (string | null)[]) {
    const ids = [...new Set(driverIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map<string, string>();
    const rows = await db.select({ id: driver.id, name: user.name }).from(driver).innerJoin(user, eq(user.id, driver.userId)).where(inArray(driver.id, ids));
    return new Map(rows.map((row) => [row.id, row.name]));
}

function lineView(order: Contract, line: ContractAllocation, role: ContractRole, tenantId: string, h: Hydrated): RentalLineView {
    const sell = perDay(order.sellPrice);
    const buy = perDay(line.buyPrice);
    // A provider's line is billed at its price; the owner's own fleet at the order's
    const model = line.carrierOrgId || line.carrierName ? buy : sell;
    const mode = (model ?? sell ?? buy)?.billableDays ?? "calendar";
    const log = h.logByLine.get(line.id) ?? [];
    // A draft or a proposal bills nothing: the days start counting once the rental runs
    const days = order.status === "draft" ? [] : lineDays({ startsOn: order.startsOn, orderEndsOn: order.endsOn, lineEndsOn: line.endsOn, mode, log, today: h.today });
    const todayEntry = log.find((entry) => entry.day === h.today);
    const provider = line.carrierOrgId || line.carrierName
        ? { id: line.carrierOrgId, name: line.carrierOrgId ? h.names.get(line.carrierOrgId) ?? null : line.carrierName }
        : null;
    const readsBuy = role === "owner" || (role === "carrier" && line.carrierOrgId === tenantId);

    return {
        id: line.id,
        truck: line.truckId ? { id: line.truckId, plate: h.trucks.get(line.truckId) ?? "—" } : null,
        truckPlate: line.truckPlate,
        driver: line.driverId ? { id: line.driverId, name: h.drivers.get(line.driverId) ?? "—" } : null,
        provider,
        buyPrice: readsBuy ? buy : null,
        endsOn: line.endsOn,
        days,
        // The client reads its own price; a provider its own; the owner the client's on its own fleet
        billing: lineBilling(days, role === "client" ? sell : readsBuy && buy ? buy : sell),
        statement: monthlyStatement(days, role === "client" ? sell : readsBuy && buy ? buy : sell),
        projectedDays: projectedDays(order.startsOn, line.endsOn ?? order.endsOn, mode),
        today: { answer: todayEntry?.driverAnswer ?? null, silent: h.silent.has(line.id) },
        disputedDays: days.filter((day) => day.disputed).length,
        notes: role === "owner" ? line.notes : null,
    };
}

/** The order's money from where the reader stands: the client's side at the order's price, the providers' side at the lines'. */
function moneyOf(order: Contract, lines: RentalLineView[], all: ContractAllocation[], role: ContractRole, tenantId: string, h: Hydrated) {
    const sell = perDay(order.sellPrice);
    const line: RentalMoneyLine = { currency: order.currency, billable: 0, projected: sell ? 0 : null, received: 0, receivable: 0, payable: 0, paid: 0, outstanding: 0 };
    const perLine: RentalDetail["money"]["perLine"] = [];
    const payments = h.payments.filter((payment) => payment.contractId === order.id);

    for (const view of lines) {
        const raw = all.find((candidate) => candidate.id === view.id);
        const buy = perDay(raw?.buyPrice ?? null);
        const mine = raw?.carrierOrgId === tenantId;

        // The client's side: every line's days at the order's price
        if (role !== "carrier" && sell) {
            const billing = lineBilling(view.days, sell);
            line.billable += billing.amount;
            if (line.projected !== null) {
                const total = view.projectedDays;
                line.projected = total === null ? null : line.projected + total * sell.rate;
            }
        }
        // The providers' side: a partner's line at its price — the owner pays it, the provider is paid it
        if (buy && (role === "owner" || mine)) {
            const billing = lineBilling(view.days, buy);
            const paid = payments.filter((payment) => payment.leg === "buy" && payment.allocationId === view.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
            if (role === "owner") {
                line.payable += billing.amount;
                line.paid += paid;
                line.outstanding += Math.max(billing.amount - paid, 0);
            } else {
                // The provider reads what it is owed as its receivable
                line.billable += billing.amount;
                line.received += paid;
                line.receivable += Math.max(billing.amount - paid, 0);
            }
            perLine.push({ allocationId: view.id, currency: order.currency, billable: round(billing.amount), paid: round(paid), outstanding: round(Math.max(billing.amount - paid, 0)) });
        }
    }

    if (role !== "carrier" && sell) {
        const received = payments.filter((payment) => payment.leg === "sell").reduce((sum, payment) => sum + Number(payment.amount), 0);
        line.received = received;
        line.receivable = Math.max(line.billable - received, 0);
    }

    const rounded: RentalMoneyLine = {
        ...line,
        billable: round(line.billable),
        projected: line.projected === null ? null : round(line.projected),
        received: round(line.received),
        receivable: round(line.receivable),
        payable: round(line.payable),
        paid: round(line.paid),
        outstanding: round(line.outstanding),
    };

    return { lines: [rounded], perLine };
}

function toRow(order: Contract, all: ContractAllocation[], role: ContractRole, tenantId: string, h: Hydrated): { view: RentalRow; lines: RentalLineView[] } {
    const mine = linesFor(all, role, tenantId);
    const lines = mine.map((line) => lineView(order, line, role, tenantId, h));
    const derived = derivedState(order, { remaining: null });
    const state = derived === "draft" && role === "client" ? "proposed" : derived;
    const money = moneyOf(order, lines, all, role, tenantId, h).lines[0];
    const sell = perDay(order.sellPrice);

    return {
        view: {
            id: order.id,
            ref: order.reference ?? "—",
            status: order.status,
            state,
            role,
            owner: { id: order.organizationId, name: h.names.get(order.organizationId) ?? "—" },
            client: order.clientOrgId || order.clientName
                ? { id: order.clientOrgId, name: order.clientOrgId ? h.names.get(order.clientOrgId) ?? null : order.clientName }
                : null,
            site: order.origin,
            startsOn: order.startsOn,
            endsOn: order.endsOn,
            currency: order.currency,
            sellPrice: role === "carrier" ? null : sell,
            trucks: lines.map((line) => line.truck?.plate ?? line.truckPlate ?? "—"),
            billableDays: lines.reduce((sum, line) => sum + line.billing.billableDays, 0),
            periodDays: lines.length === 0 ? null : lines.reduce<number | null>((sum, line) => (sum === null || line.projectedDays === null ? null : sum + line.projectedDays), 0),
            billable: money ? (role === "owner" && !sell ? money.payable : money.billable) : 0,
            attention: {
                disputed: lines.reduce((sum, line) => sum + line.disputedDays, 0),
                saidNo: lines.filter((line) => line.today.answer === "no").length,
                silent: lines.filter((line) => line.today.silent).length,
            },
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        },
        lines,
    };
}

async function visibleSet(db: Db, tenantId: string, tab: "own" | "partners" | "all", search?: string) {
    const rows = await db
        .select()
        .from(contract)
        .where(and(eq(contract.basis, "days"), visibleContracts(tenantId), tabPredicate(tab, tenantId), search ? searchWhere(search) : undefined))
        .orderBy(desc(contract.createdAt));
    const h = await hydrate(db, rows);

    return rows.flatMap((order) => {
        const all = h.byContract.get(order.id) ?? [];
        const role = roleOn(order, all, tenantId);
        return role ? [{ order, all, role, ...toRow(order, all, role, tenantId, h), h }] : [];
    });
}

/**
 * Every rental the company can read, the way the orders list carries it
 * among the trips: the row, who provides the trucks (the reader's own
 * lines), and what the reader's side comes to so far.
 */
export type RentalOrderRow = {
    view: RentalRow;
    providers: Array<{ id: string | null; name: string | null }>;
    money: { leg: "sell" | "buy"; amount: number } | null;
};

export async function rentalOrderRows(db: Db, tenantId: string): Promise<RentalOrderRow[]> {
    const set = await visibleSet(db, tenantId, "all");

    return set.map(({ view, lines, role, order }) => ({
        view,
        providers: lines.flatMap((line) => (line.provider ? [line.provider] : [])),
        // A client pays, a carrier is paid, the owner earns its price when it has one and pays its providers otherwise
        money: view.billable === 0 && lines.length === 0
            ? null
            : { leg: role === "client" ? "buy" : role === "carrier" ? "sell" : order.sellPrice ? "sell" : "buy", amount: view.billable },
    }));
}

const orderings: Record<"newest" | "period" | "reference", (a: RentalRow, b: RentalRow) => number> = {
    newest: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    period: (a, b) => a.startsOn.localeCompare(b.startsOn),
    reference: (a, b) => a.ref.localeCompare(b.ref),
};

async function detailOf(db: Db, id: string, tenantId: string, orgRole: OrgRole): Promise<RentalDetail> {
    const { row, role } = await loadContract(db, id, tenantId);
    if (row.basis !== "days") throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    const all = await db.select().from(contractAllocation).where(eq(contractAllocation.contractId, row.id)).orderBy(asc(contractAllocation.createdAt));
    const h = await hydrate(db, [row]);
    const { view, lines } = toRow(row, all, role, tenantId, h);
    const money = moneyOf(row, lines, all, role, tenantId, h);

    const canManage = role === "owner" && isOrgAuthorized(orgRole, "contract", ["update"]);
    const open = row.status !== "closed";
    const proposal = row.status === "draft" && row.clientOrgId !== null && await isOnPortal(db, row.clientOrgId);
    const canAnswer = role === "client" && proposal && isOrgAuthorized(orgRole, "contract", ["update"]);
    const providesSome = role === "owner" || all.some((line) => line.carrierOrgId === tenantId);
    const visibleLineIds = new Set(lines.map((line) => line.id));

    // The client reads what it paid; a provider what it was paid on its lines; the owner all of it
    const payments = h.payments
        .filter((payment) => payment.contractId === row.id)
        .filter((payment) => role === "owner" || (role === "client" ? payment.leg === "sell" : payment.leg === "buy" && payment.allocationId !== null && visibleLineIds.has(payment.allocationId)))
        .map((payment) => ({
            id: payment.id,
            allocationId: payment.allocationId,
            leg: payment.leg,
            amount: Number(payment.amount),
            currency: payment.currency,
            paidAt: payment.paidAt,
            reference: payment.reference,
        }));

    return {
        ...view,
        clientReference: role === "carrier" ? null : row.clientReference,
        fiscalRegime: row.fiscalRegime,
        fileUrl: role === "carrier" ? null : row.fileUrl,
        fileName: role === "carrier" ? null : row.fileName,
        notes: role === "owner" ? row.notes : null,
        version: row.version,
        lines,
        money,
        payments,
        permissions: {
            canEdit: canManage && open,
            canAddLine: canManage && open,
            canEndLine: open && providesSome && isOrgAuthorized(orgRole, "contract", ["update"]),
            canMark: open && row.status === "active" && providesSome && isOrgAuthorized(orgRole, "contract", ["update"]),
            canDispute: open && row.status === "active" && role === "client" && isOrgAuthorized(orgRole, "contract", ["update"]),
            canRecordPayment: canManage,
            canActivate: canManage && row.status === "draft" && !proposal,
            canAccept: canAnswer,
            canDecline: canAnswer,
            canClose: canManage && open,
        },
    };
}

const actorOf = (ctx: { tenant: { organizationId: string; userId: string } }) => ({
    organizationId: ctx.tenant.organizationId,
    userId: ctx.tenant.userId,
});

export const rentalsRouter = createTRPCRouter({
    list: tenantProcedure
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<RentalRow>> => {
            let items = (await visibleSet(ctx.db, ctx.tenant.organizationId, input.tab, input.search)).map((entry) => entry.view);
            if (input.state) items = items.filter((item) => item.state === input.state);
            items.sort(orderings[input.sort]);
            if (input.dir === "desc") items.reverse();
            const start = (input.page - 1) * input.pageSize;

            return { items: items.slice(start, start + input.pageSize), total: items.length, page: input.page, pageSize: input.pageSize };
        }),

    stats: tenantProcedure
        .input(z.object({ tab: z.enum(RENTAL_TABS).default("own") }))
        .query(async ({ ctx, input }): Promise<RentalStats> => {
            const tenantId = ctx.tenant.organizationId;
            const set = await visibleSet(ctx.db, tenantId, input.tab);
            const byState: RentalStats["byState"] = { draft: 0, proposed: 0, active: 0, exhausted: 0, expired: 0, closed: 0 };
            const attention = { disputed: 0, saidNo: 0, silent: 0 };
            const money = new Map<RentalMoneyLine["currency"], RentalMoneyLine>();

            for (const entry of set) {
                byState[entry.view.state] += 1;
                if (entry.order.status === "closed") continue;
                attention.disputed += entry.view.attention.disputed;
                attention.saidNo += entry.view.attention.saidNo;
                attention.silent += entry.view.attention.silent;
                for (const line of moneyOf(entry.order, entry.lines, entry.all, entry.role, tenantId, entry.h).lines) {
                    const target = money.get(line.currency) ?? { currency: line.currency, billable: 0, projected: null, received: 0, receivable: 0, payable: 0, paid: 0, outstanding: 0 };
                    for (const key of ["billable", "received", "receivable", "payable", "paid", "outstanding"] as const) target[key] = round(target[key] + line[key]);
                    money.set(line.currency, target);
                }
            }

            return { total: set.length, byState, attention, money: [...money.values()] };
        }),

    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(({ ctx, input }) => detailOf(ctx.db, input.id, ctx.tenant.organizationId, ctx.tenant.role)),

    create: authorizedTenantProcedure("contract", ["create"])
        .input(CreateRentalSchema)
        .mutation(async ({ ctx, input }) => {
            const { order } = await createRental(ctx.db, actorOf(ctx), input);
            return { id: order.id, ref: order.reference ?? "—" };
        }),

    update: authorizedTenantProcedure("contract", ["update"])
        .input(UpdateRentalSchema)
        .mutation(async ({ ctx, input }) => {
            const row = await updateRental(ctx.db, actorOf(ctx), input);
            return { id: row.id, version: row.version };
        }),

    transition: authorizedTenantProcedure("contract", ["update"])
        .input(TransitionContractSchema)
        .mutation(async ({ ctx, input }) => {
            const row = await transitionContract(ctx.db, actorOf(ctx), input);
            return { id: row.id, status: row.status, version: row.version };
        }),

    lines: createTRPCRouter({
        add: authorizedTenantProcedure("contract", ["update"])
            .input(AddLineSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await addLine(ctx.db, actorOf(ctx), input);
                return { id: row.id };
            }),
        end: authorizedTenantProcedure("contract", ["update"])
            .input(EndLineSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await endLine(ctx.db, actorOf(ctx), input);
                return { id: row.id, endsOn: row.endsOn };
            }),
        remove: authorizedTenantProcedure("contract", ["update"])
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }) => {
                await removeLine(ctx.db, actorOf(ctx), input.id);
                return { id: input.id };
            }),
    }),

    days: createTRPCRouter({
        mark: authorizedTenantProcedure("contract", ["update"])
            .input(MarkDaySchema)
            .mutation(async ({ ctx, input }) => {
                const row = await markDay(ctx.db, actorOf(ctx), input);
                return { allocationId: row.allocationId, day: row.day, state: row.state };
            }),
        dispute: authorizedTenantProcedure("contract", ["update"])
            .input(DisputeDaySchema)
            .mutation(async ({ ctx, input }) => {
                const row = await disputeDay(ctx.db, actorOf(ctx), input);
                return { allocationId: row.allocationId, day: row.day };
            }),
        settle: authorizedTenantProcedure("contract", ["update"])
            .input(SettleDisputeSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await settleDispute(ctx.db, actorOf(ctx), input);
                return { allocationId: row.allocationId, day: row.day, state: row.state };
            }),
    }),

    payments: createTRPCRouter({
        record: authorizedTenantProcedure("contract", ["update"])
            .input(RecordRentalPaymentSchema)
            .mutation(async ({ ctx, input }) => {
                const row = await recordRentalPayment(ctx.db, actorOf(ctx), input);
                return { id: row.id, contractId: row.contractId };
            }),
        list: tenantProcedure
            .input(z.object({ contractId: z.string().nonempty() }))
            .query(async ({ ctx, input }) => {
                // The detail cuts the payments by role; this is the owner's full list
                const { role } = await loadContract(ctx.db, input.contractId, ctx.tenant.organizationId);
                if (role !== "owner") throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                return (await loadPayments(ctx.db, input.contractId)).map((payment) => ({ ...payment, amount: Number(payment.amount) }));
            }),
    }),
});
