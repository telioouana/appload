import { isAuthorized, type Action, type StaffRole } from "@workspace/auth/user-permissions";
import type { KycDocumentStatus, KycStatus, RiskLevel } from "@workspace/db/types";

/**
 * The manual half of the verification state machine, shared verbatim by the
 * server mutations and the UI. The server re-guards every action — the
 * client side of this module is presentation, not authority.
 *
 * Most of a subject's status is *derived* (see derive.ts): uploading and
 * reviewing documents moves it on their own. Only the actions below are
 * discretionary, and each declares what it demands before it may run.
 */

export type KycRequirement = "note" | "reason" | "expiry" | "manager" | "admin";

export type KycAction =
    | "review-approve"
    | "review-reject"
    | "suspend"
    | "unsuspend"
    | "force-review"
    | "flag-risk"
    | "clear-risk";

export type KycVerdict =
    | { ok: true; requirements: KycRequirement[] }
    | { ok: false; code: "INVALID_STATE" | "NOT_ALLOWED" };

const REQUIREMENTS: Record<KycAction, KycRequirement[]> = {
    // Expiry is added conditionally by the caller — only requirements whose
    // document actually carries an expiry date demand one
    "review-approve": ["manager"],
    "review-reject": ["manager", "reason"],
    // Suspension cuts a partner off entirely, so it is always explained
    "suspend": ["admin", "note"],
    "unsuspend": ["admin", "note"],
    // Sends a verified subject back through review
    "force-review": ["admin", "note"],
    "flag-risk": ["manager", "reason"],
    "clear-risk": ["manager", "note"],
};

// The same statements the tRPC gate applies, so a button that renders is a
// call that will be accepted
type Gate =
    | { resource: "kyc"; action: Action<"kyc"> }
    | { resource: "risk"; action: Action<"risk"> };

const GATE: Record<KycAction, Gate> = {
    "review-approve": { resource: "kyc", action: "review" },
    "review-reject": { resource: "kyc", action: "review" },
    "suspend": { resource: "kyc", action: "override" },
    "unsuspend": { resource: "kyc", action: "override" },
    "force-review": { resource: "kyc", action: "override" },
    "flag-risk": { resource: "risk", action: "flag" },
    "clear-risk": { resource: "risk", action: "clear" },
};

/** Whether the role may perform the action at all. */
export function canPerform(role: StaffRole, action: KycAction): boolean {
    const gate = GATE[action];

    return gate.resource === "kyc"
        ? isAuthorized(role, "kyc", [gate.action])
        : isAuthorized(role, "risk", [gate.action]);
}

/**
 * What an action demands of its payload, or why it cannot run.
 *
 * `needsExpiry` comes from the document's requirement (requirements.ts), so
 * the caller resolves it rather than this module guessing at document types.
 */
export function kycActionRequirements(
    action: KycAction,
    ctx: {
        role: StaffRole;
        status?: KycStatus;
        documentStatus?: KycDocumentStatus;
        riskLevel?: RiskLevel;
        needsExpiry?: boolean;
    },
): KycVerdict {
    if (!canPerform(ctx.role, action)) return { ok: false, code: "NOT_ALLOWED" };

    // A decided document is never re-decided: a resubmission creates a new
    // row, so the history stays append-only
    if (
        (action === "review-approve" || action === "review-reject") &&
        ctx.documentStatus !== undefined &&
        ctx.documentStatus !== "pending"
    ) {
        return { ok: false, code: "INVALID_STATE" };
    }

    if (action === "suspend" && ctx.status === "suspended") {
        return { ok: false, code: "INVALID_STATE" };
    }
    if (action === "unsuspend" && ctx.status !== undefined && ctx.status !== "suspended") {
        return { ok: false, code: "INVALID_STATE" };
    }
    if (action === "clear-risk" && ctx.riskLevel === "none") {
        return { ok: false, code: "INVALID_STATE" };
    }

    const requirements = [...REQUIREMENTS[action]];

    if (action === "review-approve" && ctx.needsExpiry) {
        requirements.push("expiry");
    }

    return { ok: true, requirements };
}
