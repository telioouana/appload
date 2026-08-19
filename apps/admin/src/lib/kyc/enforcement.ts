import type { KycStatus, OwnershipStatus, RiskLevel } from "@workspace/db/types";

import { carrierEligibility, type EligibilityVerdict } from "@/lib/kyc/eligibility";
import type { CurrentDoc, IsoDate } from "@/lib/kyc/derive";

/**
 * How hard the verification rules bite on the order form.
 *
 * The rules themselves are always evaluated — an order booked against an
 * unverified carrier is flagged for review in every mode, so the backlog
 * stays visible. What the mode decides is whether a failing check *stops*
 * the booking or merely warns about it.
 *
 * This exists because the rules went live against a fleet of partners none
 * of whom had been reviewed yet. Blocking on day one would have stopped
 * every booking on the platform; `warn` lets ops keep working while the
 * backlog is cleared, and `block` is flipped on once it is.
 */
export type EnforcementMode = "warn" | "block";

export function enforcementMode(): EnforcementMode {
    return process.env.KYC_ENFORCEMENT === "block" ? "block" : "warn";
}

export type SubjectFlag = {
    kind: "driver" | "truck" | "trailer" | "link"
    label: string
    kycStatus: KycStatus
    ownershipStatus?: OwnershipStatus
};

export type OrderGate = {
    mode: EnforcementMode
    /** Whether the carrier itself may be put on a shipment */
    carrier: EligibilityVerdict
    riskLevel: RiskLevel
    riskReason: string | null
    /** Vehicles on this order that a third party owns */
    thirdParty: SubjectFlag[]
    /** Drivers and vehicles on this order that are not yet verified */
    unverified: SubjectFlag[]
    /** What proceeding demands beyond the ordinary */
    requirements: GateRequirement[]
    /** True when `mode` is block and something disqualifying is present */
    blocked: boolean
};

export type GateRequirement = "note" | "manager" | "flag";

/**
 * Turns the raw verification state of everything on an order into the single
 * verdict the form renders and the mutations enforce. Pure — the caller
 * loads the rows, this decides what they mean.
 */
export function evaluateOrderGate(input: {
    mode: EnforcementMode
    carrier: { kycStatus: KycStatus; riskLevel: RiskLevel; riskReason: string | null }
    carrierDocs: CurrentDoc[]
    subjects: SubjectFlag[]
    on: IsoDate
}): OrderGate {
    const carrier = carrierEligibility(input.carrier, input.carrierDocs, input.on);

    const thirdParty = input.subjects.filter((s) => s.ownershipStatus === "third-party");
    const unverified = input.subjects.filter((s) => s.kycStatus !== "verified");

    const requirements = new Set<GateRequirement>();

    // An unverified carrier is not a hard stop in warn mode, but the order it
    // is booked onto is always marked so the gap is findable later
    if (!carrier.eligible) {
        requirements.add("flag");
    }

    // Cargo on a truck its carrier does not own is the loss scenario this
    // whole pipeline exists to catch: never silent, always a named decision
    if (input.carrier.riskLevel === "high" || thirdParty.length > 0) {
        requirements.add("manager");
        requirements.add("note");
        requirements.add("flag");
    } else if (input.carrier.riskLevel === "watch" || unverified.length > 0) {
        requirements.add("flag");
    }

    return {
        mode: input.mode,
        carrier,
        riskLevel: input.carrier.riskLevel,
        riskReason: input.carrier.riskReason,
        thirdParty,
        unverified,
        requirements: [...requirements],
        blocked: input.mode === "block" && !carrier.eligible,
    };
}

/**
 * The machine-readable reason stamped onto an auto-flagged order. Prefixed
 * so the cause can be told apart from an operator's own flag note.
 */
export function gateFlagReason(gate: OrderGate): string | null {
    if (gate.thirdParty.length > 0) {
        return `HIGH_RISK_SUBCONTRACTOR: ${gate.thirdParty.map((s) => s.label).join(", ")} owned by a third party`;
    }
    if (gate.riskLevel === "high" || gate.riskLevel === "watch") {
        return `CARRIER_RISK_${gate.riskLevel.toUpperCase()}: ${gate.riskReason ?? "flagged carrier"}`;
    }
    if (!gate.carrier.eligible) {
        return `KYC_${gate.carrier.code}`;
    }
    if (gate.unverified.length > 0) {
        return `KYC_UNVERIFIED: ${gate.unverified.map((s) => s.label).join(", ")}`;
    }

    return null;
}
