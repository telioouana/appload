import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";

import {
    contract,
    contractAllocation,
    type Contract,
    type ContractAllocation,
    type ContractBasis,
    type ContractStatus,
} from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { movement } from "@workspace/db/movements";
import type { Location } from "@workspace/db/orders";
import { isApploadOrg, type CURRENCY, type FISCAL_REGIME, type PriceModel, type WEIGHT_UNIT } from "@workspace/db/types";

import { loadOwnContract } from "@workspace/domain/contracts/access";
import { nextReference } from "@workspace/domain/movements/counters";
import { isConnected } from "@workspace/domain/movements/link";

type Db = typeof Database;

export type ContractActor = { organizationId: string; userId: string };

export type ContractInput = {
    basis: ContractBasis;
    clientOrgId?: string | null;
    clientName?: string | null;
    clientReference?: string | null;
    origin?: Location | null;
    destination?: Location | null;
    startsOn: string;
    endsOn: string;
    committedQty: number;
    weightUnit?: (typeof WEIGHT_UNIT)[number] | null;
    currency: (typeof CURRENCY)[number];
    fiscalRegime?: (typeof FISCAL_REGIME)[number] | null;
    sellPrice?: PriceModel | null;
    notes?: string | null;
};

export type AllocationInput = {
    carrierOrgId?: string | null;
    carrierName?: string | null;
    shareQty: number;
    buyPrice?: PriceModel | null;
    truckId?: string | null;
    driverId?: string | null;
    truckPlate?: string | null;
    notes?: string | null;
};

const refuse = (message: string, code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" = "BAD_REQUEST") =>
    new TRPCError({ code, message });

const decimal = (value: number): string => String(Math.round(value * 1000) / 1000);

/**
 * A price model has to be able to price what the contract counts: days are
 * priced per day (or as one sum), trips and tons per trip, per ton or as one
 * sum. Anything else would make every trip's default null.
 */
function assertModelFits(model: PriceModel | null | undefined, basis: ContractBasis): void {
    if (!model) return;
    const rental = basis === "days";
    if (model.model === "per-day" && !rental) throw refuse("PRICE_MODEL_BASIS_MISMATCH");
    if (rental && model.model !== "per-day" && model.model !== "lump-sum") throw refuse("PRICE_MODEL_BASIS_MISMATCH");
}

/** The client half: a connected partner, never the owner itself and never Appload (it moves loads, it never orders one). */
async function assertClient(db: Db, ownerOrgId: string, clientOrgId: string | null | undefined): Promise<void> {
    if (!clientOrgId) return;
    if (clientOrgId === ownerOrgId) throw refuse("CLIENT_IS_SELF");
    if (isApploadOrg(clientOrgId)) throw refuse("APPLOAD_NOT_A_CLIENT");
    if (!await isConnected(db, ownerOrgId, clientOrgId)) throw refuse("NOT_CONNECTED");
}

/** A truck or a driver pinned to a share has to belong to whoever runs that share. */
async function assertRig(db: Db, fleetOrgId: string, input: Pick<AllocationInput, "truckId" | "driverId">): Promise<void> {
    if (input.truckId) {
        const [row] = await db.select({ id: truck.id }).from(truck).where(and(eq(truck.id, input.truckId), eq(truck.carrierId, fleetOrgId))).limit(1);
        if (!row) throw refuse("TRUCK_NOT_REGISTERED");
    }
    if (input.driverId) {
        const [row] = await db.select({ id: driver.id }).from(driver).where(and(eq(driver.id, input.driverId), eq(driver.carrierId, fleetOrgId))).limit(1);
        if (!row) throw refuse("DRIVER_NOT_REGISTERED");
    }
}

function contractColumns(input: ContractInput) {
    if (input.endsOn < input.startsOn) throw refuse("PERIOD_INVERTED");
    if (!(input.committedQty > 0)) throw refuse("QUANTITY_REQUIRED");
    assertModelFits(input.sellPrice, input.basis);

    return {
        basis: input.basis,
        clientOrgId: input.clientOrgId ?? null,
        clientName: input.clientOrgId ? null : input.clientName?.trim() || null,
        clientReference: input.clientReference?.trim() || null,
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        committedQty: decimal(input.committedQty),
        weightUnit: input.basis === "weight" ? input.weightUnit ?? "ton" : null,
        currency: input.currency,
        fiscalRegime: input.fiscalRegime ?? null,
        sellPrice: input.sellPrice ?? null,
        notes: input.notes?.trim() || null,
    };
}

export async function createContract(db: Db, actor: ContractActor, input: ContractInput): Promise<Contract> {
    await assertClient(db, actor.organizationId, input.clientOrgId);
    const reference = await nextReference(db, actor.organizationId, "CON");

    const [row] = await db
        .insert(contract)
        .values({ ...contractColumns(input), organizationId: actor.organizationId, reference, createdBy: actor.userId })
        .returning();

    if (!row) throw refuse("UNKNOWN", "CONFLICT");
    return row;
}

/**
 * Terms change while a contract runs — an amendment is a fact of the trade,
 * and the trips already filed keep the prices they were filed with. Only a
 * closed contract is beyond editing.
 */
export async function updateContract(
    db: Db,
    actor: ContractActor,
    input: ContractInput & { id: string; expectedVersion: number },
): Promise<Contract> {
    const current = await loadOwnContract(db, input.id, actor.organizationId);
    if (current.version !== input.expectedVersion) throw refuse("VERSION_CONFLICT", "CONFLICT");
    if (current.status === "closed") throw refuse("CONTRACT_CLOSED");
    // The basis is what the shares are counted in; changing it would re-read every share
    if (input.basis !== current.basis) throw refuse("BASIS_IS_FIXED");
    await assertClient(db, actor.organizationId, input.clientOrgId);

    const [row] = await db
        .update(contract)
        .set({ ...contractColumns(input), version: current.version + 1 })
        .where(and(eq(contract.id, current.id), eq(contract.version, current.version)))
        .returning();

    if (!row) throw refuse("VERSION_CONFLICT", "CONFLICT");
    return row;
}

const NEXT: Record<ContractStatus, ContractStatus[]> = {
    draft: ["active", "closed"],
    active: ["closed"],
    closed: [],
};

export async function transitionContract(
    db: Db,
    actor: ContractActor,
    input: { id: string; to: ContractStatus; expectedVersion: number },
): Promise<Contract> {
    const current = await loadOwnContract(db, input.id, actor.organizationId);
    if (current.version !== input.expectedVersion) throw refuse("VERSION_CONFLICT", "CONFLICT");
    if (!NEXT[current.status].includes(input.to)) throw refuse("INVALID_STATUS");

    const [row] = await db
        .update(contract)
        .set({ status: input.to, version: current.version + 1 })
        .where(and(eq(contract.id, current.id), eq(contract.version, current.version)))
        .returning();

    if (!row) throw refuse("VERSION_CONFLICT", "CONFLICT");
    return row;
}

async function allocationColumns(db: Db, owner: Contract, input: AllocationInput) {
    if (!(input.shareQty > 0)) throw refuse("QUANTITY_REQUIRED");
    const carrierOrgId = input.carrierOrgId ?? null;

    if (carrierOrgId === owner.organizationId) throw refuse("CARRIER_IS_SELF");
    // Appload is a partner of every company; anybody else has to be connected
    if (carrierOrgId && !isApploadOrg(carrierOrgId) && !await isConnected(db, owner.organizationId, carrierOrgId)) {
        throw refuse("NOT_CONNECTED");
    }
    assertModelFits(input.buyPrice, owner.basis);
    // Own fleet earns the owner nothing per trip: the sell side is the contract's
    if (!carrierOrgId && !input.carrierName?.trim() && input.buyPrice) throw refuse("OWN_FLEET_HAS_NO_BUY_PRICE");

    const fleetOrgId = carrierOrgId ?? owner.organizationId;
    // A typed carrier has no fleet on the portal to pin
    if ((input.truckId || input.driverId) && !carrierOrgId && input.carrierName?.trim()) throw refuse("RIG_NOT_ON_ALLOCATION");
    await assertRig(db, fleetOrgId, input);

    return {
        carrierOrgId,
        carrierName: carrierOrgId ? null : input.carrierName?.trim() || null,
        shareQty: decimal(input.shareQty),
        buyPrice: carrierOrgId || input.carrierName?.trim() ? input.buyPrice ?? null : null,
        truckId: input.truckId ?? null,
        driverId: input.driverId ?? null,
        truckPlate: input.truckId ? null : input.truckPlate?.trim() || null,
        notes: input.notes?.trim() || null,
    };
}

export async function addAllocation(
    db: Db,
    actor: ContractActor,
    input: AllocationInput & { contractId: string },
): Promise<ContractAllocation> {
    const owner = await loadOwnContract(db, input.contractId, actor.organizationId);
    if (owner.status === "closed") throw refuse("CONTRACT_CLOSED");
    const columns = await allocationColumns(db, owner, input);

    // A typed off-platform carrier has no organization row: its "carrier" is
    // its name, and it is told apart from the owner's own fleet by having one
    const [row] = await db
        .insert(contractAllocation)
        .values({ ...columns, contractId: owner.id })
        .onConflictDoNothing()
        .returning();

    if (!row) throw refuse("ALLOCATION_EXISTS", "CONFLICT");
    return row;
}

async function loadOwnAllocation(db: Db, actor: ContractActor, id: string): Promise<{ owner: Contract; allocation: ContractAllocation }> {
    const [allocation] = await db.select().from(contractAllocation).where(eq(contractAllocation.id, id)).limit(1);
    if (!allocation) throw refuse("NOT_FOUND", "NOT_FOUND");
    const owner = await loadOwnContract(db, allocation.contractId, actor.organizationId);
    return { owner, allocation };
}

export async function updateAllocation(
    db: Db,
    actor: ContractActor,
    input: AllocationInput & { id: string },
): Promise<ContractAllocation> {
    const { owner, allocation } = await loadOwnAllocation(db, actor, input.id);
    if (owner.status === "closed") throw refuse("CONTRACT_CLOSED");
    // Who runs a share is fixed once a trip is filed under it; the price and the rest may move
    if ((input.carrierOrgId ?? null) !== allocation.carrierOrgId && await linkedTrips(db, allocation.id) > 0) {
        throw refuse("ALLOCATION_HAS_TRIPS");
    }
    const columns = await allocationColumns(db, owner, input);

    const [row] = await db.update(contractAllocation).set(columns).where(eq(contractAllocation.id, allocation.id)).returning();
    if (!row) throw refuse("UNKNOWN", "CONFLICT");
    return row;
}

/** A share with trips filed under it stays: removing it would silently unlink them. */
export async function removeAllocation(db: Db, actor: ContractActor, id: string): Promise<void> {
    const { owner, allocation } = await loadOwnAllocation(db, actor, id);
    if (owner.status === "closed") throw refuse("CONTRACT_CLOSED");
    if (await linkedTrips(db, allocation.id) > 0) throw refuse("ALLOCATION_HAS_TRIPS");

    await db.delete(contractAllocation).where(eq(contractAllocation.id, allocation.id));
}

/** Every load ever filed under a share, cancelled ones included: a link is a link. */
async function linkedTrips(db: Db, allocationId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(movement).where(eq(movement.contractAllocationId, allocationId));
    return row?.n ?? 0;
}
