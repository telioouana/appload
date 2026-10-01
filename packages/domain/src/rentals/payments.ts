import "server-only";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { contractAllocation } from "@workspace/db/contracts";
import { contractPayment, type ContractPayment, type PaymentLeg } from "@workspace/db/rentals";
import type { CURRENCY } from "@workspace/db/types";

import { loadOwnContract } from "@workspace/domain/contracts/access";

type Db = typeof Database;
type Actor = { organizationId: string; userId: string };

const refuse = (message: string, code: "BAD_REQUEST" | "NOT_FOUND" = "BAD_REQUEST") => new TRPCError({ code, message });

/**
 * Money that moved against a rental, recorded by its owner: what the client
 * paid it (`sell`), what it paid a line's provider (`buy`, on that line).
 * A negative amount takes an earlier line back and needs a reference, as a
 * trip's correction does.
 */
export async function recordRentalPayment(
    db: Db,
    actor: Actor,
    input: {
        contractId: string;
        allocationId?: string | null;
        leg: PaymentLeg;
        amount: number;
        currency: (typeof CURRENCY)[number];
        paidAt: Date;
        reference?: string | null;
    },
): Promise<ContractPayment> {
    const order = await loadOwnContract(db, input.contractId, actor.organizationId);
    if (order.basis !== "days") throw refuse("NOT_FOUND", "NOT_FOUND");
    if (!(input.amount !== 0 && Math.abs(input.amount) <= 1e12)) throw refuse("AMOUNT_REQUIRED");
    if (input.amount < 0 && !input.reference?.trim()) throw refuse("CORRECTION_NEEDS_REFERENCE");
    if (input.leg === "buy" && !input.allocationId) throw refuse("LINE_REQUIRED");

    if (input.allocationId) {
        const [line] = await db
            .select({ id: contractAllocation.id })
            .from(contractAllocation)
            .where(eq(contractAllocation.id, input.allocationId))
            .limit(1);
        if (!line) throw refuse("NOT_FOUND", "NOT_FOUND");
    }

    const [row] = await db
        .insert(contractPayment)
        .values({
            contractId: order.id,
            allocationId: input.allocationId ?? null,
            leg: input.leg,
            amount: input.amount.toFixed(2),
            currency: input.currency,
            paidAt: input.paidAt,
            reference: input.reference?.trim() || null,
            recordedBy: actor.userId,
        })
        .returning();

    if (!row) throw refuse("UNKNOWN");
    return row;
}

/** Every payment on the order, newest first. */
export function loadPayments(db: Db, contractId: string): Promise<ContractPayment[]> {
    return db.select().from(contractPayment).where(eq(contractPayment.contractId, contractId)).orderBy(desc(contractPayment.paidAt));
}
