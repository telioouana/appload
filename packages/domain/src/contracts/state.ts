import type { Contract } from "@workspace/db/contracts";

import { todayInMaputo } from "@workspace/domain/contracts/price";
import type { ContractProgress } from "@workspace/domain/contracts/progress";

/**
 * What a contract is, as the page says it: the three states somebody put it
 * in, the two the trips and the calendar put it in, and "proposed" — a
 * draft as the client it names reads it, waiting on its answer. Read, never
 * stored.
 */
export const CONTRACT_STATE = ["draft", "proposed", "active", "exhausted", "expired", "closed"] as const;
export type ContractState = (typeof CONTRACT_STATE)[number];

export function derivedState(
    contract: Pick<Contract, "status" | "endsOn">,
    progress: Pick<ContractProgress, "remaining">,
    today: string = todayInMaputo(),
): ContractState {
    if (contract.status !== "active") return contract.status;
    // An open contract has nothing to run out of
    if (progress.remaining !== null && progress.remaining <= 0) return "exhausted";
    if (today > contract.endsOn) return "expired";
    return "active";
}

/**
 * Whether a trip may still be filed under the contract. A draft is not
 * agreed yet and a closed one is over; an exhausted or expired contract
 * takes the trip and flags it (flags never block — CONTRACT_OVER_COMMITTED,
 * see movements/status.ts).
 */
export const acceptsTrips = (state: ContractState): boolean => state !== "draft" && state !== "closed";
