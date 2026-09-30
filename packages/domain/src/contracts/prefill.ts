import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { contractAllocation, type Contract, type ContractAllocation, type ContractBasis } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import type { Location } from "@workspace/db/orders";
import type { CURRENCY, FISCAL_REGIME, PriceModel, WEIGHT_UNIT } from "@workspace/db/types";

import { loadContract, type ContractRole } from "@workspace/domain/contracts/access";
import { tripPrice } from "@workspace/domain/contracts/price";
import { contractProgress } from "@workspace/domain/contracts/progress";
import { acceptsTrips, derivedState, type ContractState } from "@workspace/domain/contracts/state";

type Db = typeof Database;

/** One leg of a load as the movement door takes it. */
export type PrefilledLeg = {
    total: number;
    currency: (typeof CURRENCY)[number];
    fiscalRegime?: (typeof FISCAL_REGIME)[number];
};

/**
 * What a load filed under a share starts out as. Every field is a default
 * the form shows and the user may change — the contract price is never a
 * ceiling — and the server fills in only what the input left empty.
 */
export type TripDefaults = {
    contractId: string;
    contractReference: string | null;
    allocationId: string;
    basis: ContractBasis;
    state: ContractState;
    /** What is left on the share, in the contract's unit */
    remaining: number;
    execution: "own-fleet" | "partner";
    clientOrgId: string | null;
    clientName: string | null;
    clientReference: string | null;
    carrierOrgId: string | null;
    carrierName: string | null;
    truckId: string | null;
    driverId: string | null;
    truckPlate: string | null;
    origin: Location | null;
    destination: Location | null;
    sell: PrefilledLeg | null;
    buy: PrefilledLeg | null;
    /** The model each leg was priced with, for the form's hint */
    sellModel: PriceModel | null;
    buyModel: PriceModel | null;
};

type Load = { weight: number | string | null; weightUnit: (typeof WEIGHT_UNIT)[number] | null };

/**
 * Which way round a share is read. The owner filing under a partner's share
 * hands the load over (partner, buy side from the share, sell side from the
 * contract's client half). The owner filing under its own fleet's share
 * moves it itself (sell side only). The carrier named on a share filing its
 * own trip is moving it for the contract's owner: own fleet, and what the
 * owner pays it is its sell side.
 */
export async function tripDefaultsFor(db: Db, tenantId: string, allocationId: string, load: Load): Promise<TripDefaults> {
    const [share] = await db.select().from(contractAllocation).where(eq(contractAllocation.id, allocationId)).limit(1);
    if (!share) throw new TRPCError({ code: "NOT_FOUND", message: "ALLOCATION_NOT_VISIBLE" });

    const { row, allocations, role } = await loadContract(db, share.contractId, tenantId);
    const mine = allocations.find((allocation) => allocation.id === share.id);
    // A client reads the contract; it does not file trips under somebody else's shares
    if (!mine || role === "client") throw new TRPCError({ code: "NOT_FOUND", message: "ALLOCATION_NOT_VISIBLE" });

    const progress = await contractProgress(db, row, allocations);
    const state = derivedState(row, progress);
    if (!acceptsTrips(state)) throw new TRPCError({ code: "BAD_REQUEST", message: "CONTRACT_NOT_OPEN" });

    return shapeDefaults(row, mine, role, state, progress.byAllocation.get(mine.id)?.remaining ?? 0, load);
}

export function shapeDefaults(
    row: Contract,
    share: ContractAllocation,
    role: ContractRole,
    state: ContractState,
    remaining: number,
    load: Load,
): TripDefaults {
    const leg = (model: PriceModel | null): PrefilledLeg | null => {
        const total = tripPrice(model, load);
        return total === null ? null : { total, currency: row.currency, fiscalRegime: row.fiscalRegime ?? undefined };
    };

    const base = {
        contractId: row.id,
        contractReference: row.reference,
        allocationId: share.id,
        basis: row.basis,
        state,
        remaining,
        truckId: share.truckId,
        driverId: share.driverId,
        truckPlate: share.truckPlate,
        origin: row.origin,
        destination: row.destination,
    };

    if (role === "carrier") {
        return {
            ...base,
            execution: "own-fleet",
            clientOrgId: row.organizationId,
            clientName: null,
            clientReference: row.clientReference,
            carrierOrgId: null,
            carrierName: null,
            sell: leg(share.buyPrice),
            buy: null,
            sellModel: share.buyPrice,
            buyModel: null,
        };
    }

    const partner = share.carrierOrgId !== null || share.carrierName !== null;

    return {
        ...base,
        execution: partner ? "partner" : "own-fleet",
        clientOrgId: row.clientOrgId,
        clientName: row.clientName,
        clientReference: row.clientReference,
        carrierOrgId: partner ? share.carrierOrgId : null,
        carrierName: partner ? share.carrierName : null,
        sell: row.clientOrgId || row.clientName ? leg(row.sellPrice) : null,
        buy: partner ? leg(share.buyPrice) : null,
        sellModel: row.clientOrgId || row.clientName ? row.sellPrice : null,
        buyModel: partner ? share.buyPrice : null,
    };
}
