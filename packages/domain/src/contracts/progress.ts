import { and, inArray, ne, sql } from "drizzle-orm";

import type { Contract, ContractAllocation } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import { movement } from "@workspace/db/movements";

import { billableDays, todayInMaputo } from "@workspace/domain/contracts/price";

type Db = typeof Database;

export type AllocationProgress = {
    allocationId: string;
    /** The share, in the contract's unit */
    share: number;
    /** What the share has been drawn down by: every live trip, or the days elapsed on a rental */
    consumed: number;
    /** Of that, what has arrived (delivered or closed); on a rental, the same as consumed */
    delivered: number;
    remaining: number;
    /** Live trips under the share, whatever the basis */
    trips: number;
};

export type ContractProgress = {
    committed: number;
    consumed: number;
    delivered: number;
    remaining: number;
    trips: number;
    byAllocation: Map<string, AllocationProgress>;
};

/** What the live trips under each share add up to, in one query for any number of shares. */
export type AllocationUsage = { trips: number; deliveredTrips: number; tons: number; deliveredTons: number };

export async function allocationUsage(db: Db, allocationIds: string[]): Promise<Map<string, AllocationUsage>> {
    if (allocationIds.length === 0) return new Map();

    const rows = await db
        .select({
            allocationId: movement.contractAllocationId,
            trips: sql<number>`count(*)::int`,
            deliveredTrips: sql<number>`count(*) filter (where ${movement.status} in ('delivered', 'closed'))::int`,
            tons: sql<number>`coalesce(sum(case ${movement.weightUnit} when 'kg' then ${movement.weight} / 1000 when 'ton' then ${movement.weight} else 0 end), 0)::float`,
            deliveredTons: sql<number>`coalesce(sum(case ${movement.weightUnit} when 'kg' then ${movement.weight} / 1000 when 'ton' then ${movement.weight} else 0 end) filter (where ${movement.status} in ('delivered', 'closed')), 0)::float`,
        })
        .from(movement)
        .where(and(inArray(movement.contractAllocationId, allocationIds), ne(movement.status, "cancelled")))
        .groupBy(movement.contractAllocationId);

    return new Map(rows.map((row) => [row.allocationId ?? "", row]));
}

type ContractTerms = Pick<Contract, "basis" | "startsOn" | "endsOn" | "committedQty">;
type Share = Pick<ContractAllocation, "id" | "shareQty" | "buyPrice">;

/**
 * How far a contract has been drawn down, read off its trips — never a
 * stored counter, the same rule as subscription usage. A trip counts the
 * moment it is filed and stops counting when it is cancelled; "delivered"
 * is the part that has arrived. On a rental the commitment is time, so
 * consumption is the days elapsed since the start, capped at the period,
 * and the trips are only information.
 */
export function summarizeProgress(
    contract: ContractTerms,
    allocations: Share[],
    usage: Map<string, AllocationUsage>,
    today: string = todayInMaputo(),
): ContractProgress {
    // Rental time runs from the first day to today, never past the end
    const elapsedUntil = today < contract.endsOn ? today : contract.endsOn;

    const byAllocation = new Map<string, AllocationProgress>();
    let consumed = 0;
    let delivered = 0;
    let trips = 0;

    for (const allocation of allocations) {
        const row = usage.get(allocation.id);
        const share = Number(allocation.shareQty);
        let used: number;
        let arrived: number;

        if (contract.basis === "days") {
            const mode = allocation.buyPrice?.model === "per-day" ? allocation.buyPrice.billableDays : "calendar";
            used = Math.min(share, billableDays(contract.startsOn, elapsedUntil, mode));
            arrived = used;
        } else if (contract.basis === "weight") {
            used = row?.tons ?? 0;
            arrived = row?.deliveredTons ?? 0;
        } else {
            used = row?.trips ?? 0;
            arrived = row?.deliveredTrips ?? 0;
        }

        const progress: AllocationProgress = {
            allocationId: allocation.id,
            share,
            consumed: used,
            delivered: arrived,
            remaining: share - used,
            trips: row?.trips ?? 0,
        };
        byAllocation.set(allocation.id, progress);
        consumed += used;
        delivered += arrived;
        trips += progress.trips;
    }

    const committed = Number(contract.committedQty);

    return { committed, consumed, delivered, remaining: committed - consumed, trips, byAllocation };
}

/** One contract's progress, the two steps above in one call. */
export async function contractProgress(
    db: Db,
    contract: ContractTerms,
    allocations: Share[],
    today: string = todayInMaputo(),
): Promise<ContractProgress> {
    const usage = await allocationUsage(db, allocations.map((row) => row.id));
    return summarizeProgress(contract, allocations, usage, today);
}
