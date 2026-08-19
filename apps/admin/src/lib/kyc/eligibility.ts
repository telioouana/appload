import type { KycStatus, RiskLevel } from "@workspace/db/types";

import { CONTRACT_DOC } from "@/lib/kyc/requirements";
import { isValid, type CurrentDoc, type IsoDate } from "@/lib/kyc/derive";

/**
 * Whether a partner may be put on a shipment, and what booking one costs.
 *
 * Pure and shared: the order form renders these verdicts as banners and
 * badges, and the order procedures re-apply them as guards. As with the
 * order state machine, the client side is presentation — the server decides.
 */

export type EligibilityCode =
    | "CARRIER_NOT_VERIFIED"
    | "CARRIER_CONTRACT_MISSING"
    | "CARRIER_CONTRACT_EXPIRED"
    | "CARRIER_SUSPENDED";

export type EligibilityVerdict =
    | { eligible: true }
    | { eligible: false; code: EligibilityCode };

/** What booking this party demands beyond the ordinary. */
export type BookingRequirement = "note" | "manager" | "flag";

/**
 * A carrier operates only when it is fully verified *and* holds an approved,
 * unexpired signed contract. The contract is called out separately because a
 * missing one is disqualifying on its own, whatever else the carrier holds.
 */
export function carrierEligibility(
    carrier: { kycStatus: KycStatus },
    docs: CurrentDoc[],
    on: IsoDate,
): EligibilityVerdict {
    if (carrier.kycStatus === "suspended") {
        return { eligible: false, code: "CARRIER_SUSPENDED" };
    }

    const contract = docs.find((doc) => doc.type === CONTRACT_DOC)

    if (!contract || contract.status !== "approved") {
        return { eligible: false, code: "CARRIER_CONTRACT_MISSING" };
    }
    if (!isValid(contract, on)) {
        return { eligible: false, code: "CARRIER_CONTRACT_EXPIRED" };
    }

    if (carrier.kycStatus !== "verified") {
        return { eligible: false, code: "CARRIER_NOT_VERIFIED" };
    }

    return { eligible: true };
}

/**
 * What booking a flagged carrier or a third-party vehicle demands. A flag
 * never blocks on its own — it raises the price of proceeding, so that the
 * decision to accept the risk has a name and a reason attached to it.
 */
export function bookingRequirements(ctx: {
    riskLevel: RiskLevel;
    thirdPartyVehicle?: boolean;
}): BookingRequirement[] {
    if (ctx.riskLevel === "high" || ctx.thirdPartyVehicle) {
        return ["manager", "note", "flag"];
    }
    if (ctx.riskLevel === "watch") {
        return ["flag"];
    }

    return [];
}
