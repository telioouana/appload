import "server-only";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { contract, contractAllocation, type Contract, type ContractAllocation } from "@workspace/db/contracts";
import { rentalDay, type RentalDay, type RentalDayState } from "@workspace/db/rentals";

import { todayInMaputo } from "@workspace/domain/contracts/price";

type Db = typeof Database;
type Actor = { organizationId: string; userId: string };

const refuse = (message: string, code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" = "BAD_REQUEST") => new TRPCError({ code, message });

/** The line and its order, or NOT_FOUND. */
export async function loadLine(db: Db, allocationId: string): Promise<{ order: Contract; line: ContractAllocation }> {
    const [row] = await db
        .select({ order: contract, line: contractAllocation })
        .from(contractAllocation)
        .innerJoin(contract, eq(contract.id, contractAllocation.contractId))
        .where(eq(contractAllocation.id, allocationId))
        .limit(1);

    if (!row || row.order.basis !== "days") throw refuse("NOT_FOUND", "NOT_FOUND");
    return row;
}

/** Who provides the truck on a line: the carrier, or the order's owner for its own fleet. */
export const providerOf = (order: Contract, line: ContractAllocation): string => line.carrierOrgId ?? order.organizationId;

/** A day of the line's period, up to today. */
function assertDayOnLine(order: Contract, line: ContractAllocation, day: string, today = todayInMaputo()): void {
    if (day > today) throw refuse("DAY_IN_FUTURE");
    const end = [order.endsOn, line.endsOn].filter((value): value is string => value !== null).sort()[0] ?? null;
    if (day < order.startsOn || (end !== null && day > end)) throw refuse("DAY_OUT_OF_PERIOD");
}

/**
 * The transporter marks how one of its truck's days counts (the owner may
 * too). A mark replaces the previous one; the client's dispute on that day,
 * if any, stays until settled.
 */
export async function markDay(
    db: Db,
    actor: Actor,
    input: { allocationId: string; day: string; state: RentalDayState; note?: string | null },
): Promise<RentalDay> {
    const { order, line } = await loadLine(db, input.allocationId);
    if (actor.organizationId !== providerOf(order, line) && actor.organizationId !== order.organizationId) throw refuse("NOT_THE_PROVIDER", "FORBIDDEN");
    if (order.status === "closed") throw refuse("CONTRACT_CLOSED");
    assertDayOnLine(order, line, input.day);

    const [row] = await db
        .insert(rentalDay)
        .values({ allocationId: line.id, day: input.day, state: input.state, note: input.note ?? null, recordedBy: actor.userId, recordedOrgId: actor.organizationId })
        .onConflictDoUpdate({
            target: [rentalDay.allocationId, rentalDay.day],
            set: { state: input.state, note: input.note ?? null, recordedBy: actor.userId, recordedOrgId: actor.organizationId },
        })
        .returning();

    if (!row) throw refuse("UNKNOWN");
    return row;
}

/** The client says a day did not count as billed. The row is kept as the provider last marked it, with the dispute on it. */
export async function disputeDay(
    db: Db,
    actor: Actor,
    input: { allocationId: string; day: string; note?: string | null },
): Promise<RentalDay> {
    const { order, line } = await loadLine(db, input.allocationId);
    if (order.clientOrgId !== actor.organizationId) throw refuse("NOT_THE_CLIENT", "FORBIDDEN");
    if (order.status === "closed") throw refuse("CONTRACT_CLOSED");
    assertDayOnLine(order, line, input.day);

    const dispute = { disputedAt: new Date(), disputedBy: actor.userId, disputeNote: input.note ?? null };
    const [row] = await db
        .insert(rentalDay)
        .values({ allocationId: line.id, day: input.day, state: "worked", ...dispute })
        .onConflictDoUpdate({ target: [rentalDay.allocationId, rentalDay.day], set: dispute })
        .returning();

    if (!row) throw refuse("UNKNOWN");
    return row;
}

/**
 * A dispute ends one of two ways: the provider accepts and the day takes
 * the state the client claims (off, unless told otherwise), or the client
 * withdraws. Either way the dispute comes off the day.
 */
export async function settleDispute(
    db: Db,
    actor: Actor,
    input: { allocationId: string; day: string; resolution: "accept" | "withdraw"; state?: RentalDayState },
): Promise<RentalDay> {
    const { order, line } = await loadLine(db, input.allocationId);
    const provider = actor.organizationId === providerOf(order, line) || actor.organizationId === order.organizationId;
    const client = actor.organizationId === order.clientOrgId;

    if (input.resolution === "accept" && !provider) throw refuse("NOT_THE_PROVIDER", "FORBIDDEN");
    if (input.resolution === "withdraw" && !client) throw refuse("NOT_THE_CLIENT", "FORBIDDEN");

    const cleared = { disputedAt: null, disputedBy: null, disputeNote: null };
    const [row] = await db
        .update(rentalDay)
        .set(input.resolution === "accept"
            ? { ...cleared, state: input.state ?? "off", recordedBy: actor.userId, recordedOrgId: actor.organizationId }
            : cleared)
        .where(and(eq(rentalDay.allocationId, line.id), eq(rentalDay.day, input.day)))
        .returning();

    if (!row) throw refuse("NOT_FOUND", "NOT_FOUND");
    return row;
}

/** The log of several lines, oldest first. */
export function loadLog(db: Db, allocationIds: string[]): Promise<RentalDay[]> {
    if (allocationIds.length === 0) return Promise.resolve([]);
    return db.select().from(rentalDay).where(inArray(rentalDay.allocationId, allocationIds)).orderBy(rentalDay.day);
}
