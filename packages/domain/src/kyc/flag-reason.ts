/**
 * The machine-readable reason `gateFlagReason` stamps onto an auto-flagged
 * order, read back for display.
 *
 * The column holds `CODE`, `CODE: detail`, or either followed by ` — note`
 * when the operator explained why they accepted the risk. Only the code is
 * translated: the detail names plates or the carrier's recorded risk reason,
 * and the note is quoted as written. A reason that matches no code is an
 * operator's own words and is shown as they are.
 */
export const FLAG_REASON_CODES = [
    "KYC_CARRIER_NOT_VERIFIED",
    "KYC_CARRIER_CONTRACT_MISSING",
    "KYC_CARRIER_CONTRACT_EXPIRED",
    "KYC_CARRIER_SUSPENDED",
    "KYC_UNVERIFIED",
    "HIGH_RISK_SUBCONTRACTOR",
    "CARRIER_RISK_HIGH",
    "CARRIER_RISK_WATCH",
] as const;

export type FlagReasonCode = (typeof FLAG_REASON_CODES)[number];

export type ParsedFlagReason =
    | { code: FlagReasonCode; detail: string | null; note: string | null }
    | { code: null; detail: null; note: string };

const PATTERN = new RegExp(`^(${FLAG_REASON_CODES.join("|")})(?::\\s*(.*?))?(?:\\s+—\\s+(.*))?$`, "s");

// Rows written before the wording moved to the client carry these in English
const LEGACY_THIRD_PARTY_TAIL = / owned by a third party$/;
const LEGACY_RISK_PLACEHOLDER = "flagged carrier";

export function parseFlagReason(reason: string): ParsedFlagReason {
    const match = PATTERN.exec(reason.trim());

    if (!match) {
        return { code: null, detail: null, note: reason.trim() };
    }

    const code = match[1] as FlagReasonCode;
    let detail = match[2]?.trim() || null;
    const note = match[3]?.trim() || null;

    if (code === "HIGH_RISK_SUBCONTRACTOR" && detail) {
        detail = detail.replace(LEGACY_THIRD_PARTY_TAIL, "");
    }
    if (code.startsWith("CARRIER_RISK_") && detail === LEGACY_RISK_PLACEHOLDER) {
        detail = null;
    }

    return { code, detail, note };
}
