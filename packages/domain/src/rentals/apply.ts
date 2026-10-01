import "server-only";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { contract, contractAllocation, type Contract, type ContractAllocation } from "@workspace/db/contracts";
import type { Location } from "@workspace/db/orders";
import { rentalDay } from "@workspace/db/rentals";
import type { CURRENCY, FISCAL_REGIME, PriceModel } from "@workspace/db/types";

import { loadOwnContract } from "@workspace/domain/contracts/access";
import { addAllocation, createContract, removeAllocation, updateContract, type ContractActor } from "@workspace/domain/contracts/apply";
import { todayInMaputo } from "@workspace/domain/contracts/price";
import { loadLine, providerOf } from "@workspace/domain/rentals/log";

type Db = typeof Database;

const refuse = (message: string, code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "BAD_REQUEST") => new TRPCError({ code, message });

/** One truck at the client's service: the rig, who provides it, and what the owner pays that provider. */
export type RentalLineInput = {
    truckId?: string | null;
    truckPlate?: string | null;
    driverId?: string | null;
    carrierOrgId?: string | null;
    carrierName?: string | null;
    buyPrice?: PriceModel | null;
    notes?: string | null;
};

export type RentalInput = {
    clientOrgId?: string | null;
    clientName?: string | null;
    clientReference?: string | null;
    /** Where the trucks work; a rental has no lane */
    site?: Location | null;
    startsOn: string;
    /** Null is an open period: as long as the client needs the trucks */
    endsOn: string | null;
    currency: (typeof CURRENCY)[number];
    fiscalRegime?: (typeof FISCAL_REGIME)[number] | null;
    /** What the client pays, per day; null when the owner is the client of its own fleet */
    sellPrice?: PriceModel | null;
    notes?: string | null;
    lines: RentalLineInput[];
};

const isPerDay = (model: PriceModel | null | undefined) => !model || model.model === "per-day";

/**
 * A truck can be at one client's service at a time: a line refuses a truck
 * already on another rental whose period overlaps, draft or active. A
 * typed plate is somebody else's truck and cannot be checked.
 */
async function assertTruckFree(db: Db, truckId: string, period: { startsOn: string; endsOn: string | null }, except?: string): Promise<void> {
    const [busy] = await db
        .select({ id: contractAllocation.id })
        .from(contractAllocation)
        .innerJoin(contract, eq(contract.id, contractAllocation.contractId))
        .where(and(
            eq(contractAllocation.truckId, truckId),
            eq(contract.basis, "days"),
            inArray(contract.status, ["draft", "active"]),
            except ? ne(contract.id, except) : undefined,
            // The line's own end, else the order's, else open
            or(isNull(sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn})`), sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn}) >= ${period.startsOn}`),
            period.endsOn === null ? undefined : sql`${contract.startsOn} <= ${period.endsOn}`,
        ))
        .limit(1);

    if (busy) throw refuse("TRUCK_ON_RENTAL", "CONFLICT");
}

async function addLineTo(db: Db, actor: ContractActor, order: Contract, line: RentalLineInput): Promise<ContractAllocation> {
    if (!line.truckId && !line.truckPlate?.trim()) throw refuse("LINE_NEEDS_TRUCK");
    if (!isPerDay(line.buyPrice)) throw refuse("PRICE_MODEL_BASIS_MISMATCH");
    if (line.truckId) await assertTruckFree(db, line.truckId, order);

    // The contract door checks the rest: a connected carrier, a rig the
    // provider owns, no buy price on the owner's own fleet
    return addAllocation(db, actor, {
        contractId: order.id,
        carrierOrgId: line.carrierOrgId ?? null,
        carrierName: line.carrierName ?? null,
        shareQty: null,
        buyPrice: line.buyPrice ?? null,
        truckId: line.truckId ?? null,
        driverId: line.driverId ?? null,
        truckPlate: line.truckPlate?.trim() || null,
        notes: line.notes ?? null,
    });
}

/**
 * Files a rental: a `contract` on the days basis with an open quantity (the
 * period is the commitment), its site as the one place, and one line per
 * truck. Numbered, proposed to a client on the portal and notified exactly
 * like a multi-trip order — it is one, counted in days.
 */
export async function createRental(db: Db, actor: ContractActor, input: RentalInput): Promise<{ order: Contract; lines: ContractAllocation[] }> {
    if (input.lines.length === 0) throw refuse("LINE_NEEDS_TRUCK");
    if (!isPerDay(input.sellPrice)) throw refuse("PRICE_MODEL_BASIS_MISMATCH");

    const order = await createContract(db, actor, {
        basis: "days",
        clientOrgId: input.clientOrgId ?? null,
        clientName: input.clientName ?? null,
        clientReference: input.clientReference ?? null,
        origin: input.site ?? null,
        destination: null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        committedQty: null,
        weightUnit: null,
        currency: input.currency,
        fiscalRegime: input.fiscalRegime ?? null,
        sellPrice: input.sellPrice ?? null,
        notes: input.notes ?? null,
    });

    const lines: ContractAllocation[] = [];
    for (const line of input.lines) lines.push(await addLineTo(db, actor, order, line));

    return { order, lines };
}

export async function updateRental(
    db: Db,
    actor: ContractActor,
    input: { id: string; expectedVersion: number } & Omit<RentalInput, "lines">,
): Promise<Contract> {
    if (!isPerDay(input.sellPrice)) throw refuse("PRICE_MODEL_BASIS_MISMATCH");
    const order = await loadOwnContract(db, input.id, actor.organizationId);
    if (order.basis !== "days") throw refuse("NOT_FOUND", "NOT_FOUND");

    return updateContract(db, actor, {
        id: input.id,
        expectedVersion: input.expectedVersion,
        basis: "days",
        clientOrgId: input.clientOrgId ?? null,
        clientName: input.clientName ?? null,
        clientReference: input.clientReference ?? null,
        origin: input.site ?? null,
        destination: null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        committedQty: null,
        weightUnit: null,
        currency: input.currency,
        fiscalRegime: input.fiscalRegime ?? null,
        sellPrice: input.sellPrice ?? null,
        notes: input.notes ?? null,
    });
}

export async function addLine(db: Db, actor: ContractActor, input: RentalLineInput & { contractId: string }): Promise<ContractAllocation> {
    const order = await loadOwnContract(db, input.contractId, actor.organizationId);
    if (order.basis !== "days") throw refuse("NOT_FOUND", "NOT_FOUND");
    if (order.status === "closed") throw refuse("CONTRACT_CLOSED");
    return addLineTo(db, actor, order, input);
}

/** A truck leaves the rental early: its line ends on that day and bills no further. The owner or the truck's provider says so. */
export async function endLine(db: Db, actor: ContractActor, input: { id: string; endsOn: string }): Promise<ContractAllocation> {
    const { order, line } = await loadLine(db, input.id);
    if (actor.organizationId !== order.organizationId && actor.organizationId !== providerOf(order, line)) throw refuse("NOT_THE_PROVIDER", "FORBIDDEN");
    if (input.endsOn < order.startsOn || (order.endsOn !== null && input.endsOn > order.endsOn)) throw refuse("DAY_OUT_OF_PERIOD");

    const [row] = await db.update(contractAllocation).set({ endsOn: input.endsOn }).where(eq(contractAllocation.id, line.id)).returning();
    if (!row) throw refuse("UNKNOWN");
    return row;
}

/** A line with days on its log stays: its history is the client's record too. */
export async function removeLine(db: Db, actor: ContractActor, id: string): Promise<void> {
    const [logged] = await db.select({ n: count() }).from(rentalDay).where(eq(rentalDay.allocationId, id));
    if ((logged?.n ?? 0) > 0) throw refuse("LINE_HAS_LOG");
    await removeAllocation(db, actor, id);
}

/** Whether a truck is on an active rental today, for the fleet badge and the load form's warning. */
export async function activeRentalOf(db: Db, truckIds: string[], today = todayInMaputo()): Promise<Map<string, { contractId: string; reference: string | null; clientOrgId: string | null; clientName: string | null; until: string | null }>> {
    if (truckIds.length === 0) return new Map();

    const rows = await db
        .select({
            truckId: contractAllocation.truckId,
            contractId: contract.id,
            reference: contract.reference,
            clientOrgId: contract.clientOrgId,
            clientName: contract.clientName,
            until: sql<string | null>`coalesce(${contractAllocation.endsOn}, ${contract.endsOn})`,
        })
        .from(contractAllocation)
        .innerJoin(contract, eq(contract.id, contractAllocation.contractId))
        .where(and(
            inArray(contractAllocation.truckId, truckIds),
            eq(contract.basis, "days"),
            eq(contract.status, "active"),
            sql`${contract.startsOn} <= ${today}`,
            or(isNull(sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn})`), sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn}) >= ${today}`),
        ));

    return new Map(rows.flatMap((row) => row.truckId ? [[row.truckId, { contractId: row.contractId, reference: row.reference, clientOrgId: row.clientOrgId, clientName: row.clientName, until: row.until }]] : []));
}
