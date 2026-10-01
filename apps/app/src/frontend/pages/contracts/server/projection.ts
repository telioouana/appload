import "server-only";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { contract, contractAllocation, type ContractAllocation, type ContractBasis } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import type { CURRENCY } from "@workspace/db/types";
import { loadContract, roleOn, type ContractRole } from "@workspace/domain/contracts/access";
import { unitOf } from "@workspace/domain/contracts/price";
import { allocationUsage, summarizeProgress } from "@workspace/domain/contracts/progress";
import { acceptsTrips, derivedState, type ContractState } from "@workspace/domain/contracts/state";

import { loadNames } from "@/frontend/pages/movements/server/projection";

type Db = typeof Database;

/** A share the load form can file a trip under, as the picker lists it. */
export type OpenShare = {
    /** The allocation id — what the load is filed with */
    id: string;
    contractId: string;
    contractReference: string;
    basis: ContractBasis;
    unit: "trip" | "ton" | "day";
    execution: "own-fleet" | "partner";
    /** The other company on the share: the carrier to the owner, the owner to the carrier; null is the owner's own fleet */
    counterparty: string | null;
    role: ContractRole;
    /** Null on an open share */
    remaining: number | null;
    currency: (typeof CURRENCY)[number];
};

/**
 * Every share this company may file a trip under right now: the shares of
 * its own running contracts, and the shares other companies allocated to it.
 * A draft or closed contract offers none; an exhausted or expired one still
 * does (the trip is flagged, never refused).
 */
export async function openShares(db: Db, tenantId: string): Promise<OpenShare[]> {
    const rows = await db
        .select()
        .from(contract)
        .where(and(
            eq(contract.status, "active"),
            // A rental's trucks do short runs on site; nobody files them as trips
            sql`${contract.basis} <> 'days'`,
            or(
                eq(contract.organizationId, tenantId),
                sql`exists (select 1 from ${contractAllocation} where ${and(
                    eq(contractAllocation.contractId, contract.id),
                    eq(contractAllocation.carrierOrgId, tenantId),
                )})`,
            ),
        ))
        .orderBy(asc(contract.reference));

    if (rows.length === 0) return [];

    const allocations = await db
        .select()
        .from(contractAllocation)
        .where(inArray(contractAllocation.contractId, rows.map((row) => row.id)))
        .orderBy(asc(contractAllocation.createdAt));
    const usage = await allocationUsage(db, allocations.map((row) => row.id));
    const names = await loadNames(db, [...rows.map((row) => row.organizationId), ...allocations.map((row) => row.carrierOrgId)]);

    const shares: OpenShare[] = [];

    for (const row of rows) {
        const all = allocations.filter((allocation) => allocation.contractId === row.id);
        const role = roleOn(row, all, tenantId);
        if (!role || role === "client") continue;

        const progress = summarizeProgress(row, all, usage);
        if (!acceptsTrips(derivedState(row, progress))) continue;

        const mine = role === "owner" ? all : all.filter((allocation) => allocation.carrierOrgId === tenantId);

        for (const share of mine) {
            const partner = share.carrierOrgId !== null || share.carrierName !== null;
            shares.push({
                id: share.id,
                contractId: row.id,
                contractReference: row.reference ?? "—",
                basis: row.basis,
                unit: unitOf(row.basis),
                execution: role === "carrier" || !partner ? "own-fleet" : "partner",
                counterparty: role === "carrier"
                    ? names.get(row.organizationId) ?? null
                    : share.carrierOrgId ? names.get(share.carrierOrgId) ?? null : share.carrierName,
                role,
                remaining: progress.byAllocation.get(share.id)?.remaining ?? null,
                currency: row.currency,
            });
        }
    }

    return shares;
}

/** The contract a load sits under, as its page shows it. */
export type ContractSummary = {
    id: string;
    ref: string;
    allocationId: string;
    basis: ContractBasis;
    unit: "trip" | "ton" | "day";
    state: ContractState;
    role: ContractRole;
    /** What is left on the share the load was filed under; null on an open one */
    remaining: number | null;
    counterparty: string | null;
};

/** Null when the reader may not see the contract: the load's page then says nothing about it. */
export async function contractSummaryFor(db: Db, allocationId: string, tenantId: string): Promise<ContractSummary | null> {
    const [share] = await db.select().from(contractAllocation).where(eq(contractAllocation.id, allocationId)).limit(1);
    if (!share) return null;

    let loaded: Awaited<ReturnType<typeof loadContract>>;
    try {
        loaded = await loadContract(db, share.contractId, tenantId);
    } catch (error) {
        if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
        throw error;
    }

    const { row, allocations, role } = loaded;
    const mine: ContractAllocation | undefined = allocations.find((allocation) => allocation.id === share.id);
    if (!mine && role !== "client") return null;

    const usage = await allocationUsage(db, allocations.map((allocation) => allocation.id));
    const progress = summarizeProgress(row, allocations, usage);
    const names = await loadNames(db, [row.organizationId, share.carrierOrgId]);

    return {
        id: row.id,
        ref: row.reference ?? "—",
        allocationId: share.id,
        basis: row.basis,
        unit: unitOf(row.basis),
        state: derivedState(row, progress),
        role,
        remaining: progress.byAllocation.get(share.id)?.remaining ?? progress.remaining,
        counterparty: role === "owner"
            ? share.carrierOrgId ? names.get(share.carrierOrgId) ?? null : share.carrierName
            : names.get(row.organizationId) ?? null,
    };
}
