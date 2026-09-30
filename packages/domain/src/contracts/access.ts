import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { contract, contractAllocation, type Contract, type ContractAllocation } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";

type Db = typeof Database;

/** Which side of a contract the reader is on. */
export type ContractRole = "owner" | "client" | "carrier";

/**
 * Every contract this company is a side of: the ones in its books, the
 * ones naming it as the client, and the ones with a share allocated to it.
 * Composed into every read, like `visibleMovements`.
 */
export const visibleContracts = (tenantId: string): SQL =>
    or(
        eq(contract.organizationId, tenantId),
        eq(contract.clientOrgId, tenantId),
        sql`exists (select 1 from ${contractAllocation} where ${and(
            eq(contractAllocation.contractId, contract.id),
            eq(contractAllocation.carrierOrgId, tenantId),
        )})`,
    ) as SQL;

export function roleOn(
    row: Pick<Contract, "organizationId" | "clientOrgId">,
    allocations: Array<Pick<ContractAllocation, "carrierOrgId">>,
    tenantId: string,
): ContractRole | null {
    if (row.organizationId === tenantId) return "owner";
    if (row.clientOrgId === tenantId) return "client";
    if (allocations.some((allocation) => allocation.carrierOrgId === tenantId)) return "carrier";
    return null;
}

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

/**
 * One contract the caller may read, with its shares and its role, or a 404
 * — never a 403, telling a stranger a contract exists is telling them
 * something. A carrier gets only its own share: what the owner pays the
 * other transporters is the owner's business.
 */
export async function loadContract(
    db: Db,
    id: string,
    tenantId: string,
): Promise<{ row: Contract; allocations: ContractAllocation[]; role: ContractRole }> {
    const [row] = await db
        .select()
        .from(contract)
        .where(and(eq(contract.id, id), visibleContracts(tenantId)))
        .limit(1);

    if (!row) throw notFound();

    const all = await db
        .select()
        .from(contractAllocation)
        .where(eq(contractAllocation.contractId, row.id))
        .orderBy(contractAllocation.createdAt);

    const role = roleOn(row, all, tenantId);
    if (!role) throw notFound();

    const allocations = role === "carrier" ? all.filter((allocation) => allocation.carrierOrgId === tenantId) : all;

    return { row, allocations, role };
}

/** The same, for what only the owner may do. */
export async function loadOwnContract(db: Db, id: string, tenantId: string): Promise<Contract> {
    const [row] = await db
        .select()
        .from(contract)
        .where(and(eq(contract.id, id), eq(contract.organizationId, tenantId)))
        .limit(1);

    if (!row) throw notFound();

    return row;
}
