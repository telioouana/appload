import type {
    KycDocumentStatus,
    KycDocumentType,
    KycStatus,
    KycSubjectKind,
} from "@workspace/db/types";

import { REQUIRED_DOCS, warnDays, type DocRequirement } from "@/lib/kyc/requirements";

/**
 * Verification status derivation. Pure and shared verbatim by the server
 * mutations and the UI: the server writes the result to `kycStatus` so lists
 * can filter on it, but this function owns the value and recomputes it after
 * every document change.
 *
 * `today` is always injected. Nothing here reads the clock, so a status is
 * reproducible from its inputs and testable without freezing time.
 */

/** The shape the derivation needs — any row with these fields will do. */
export type CurrentDoc = {
    type: KycDocumentType
    status: KycDocumentStatus
    expiresAt: string | null
}

/** An ISO calendar day (YYYY-MM-DD), matching the pg `date` columns. */
export type IsoDate = string

export function today(now: Date = new Date()): IsoDate {
    return now.toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
    const parsed = new Date(`${date}T00:00:00Z`)
    parsed.setUTCDate(parsed.getUTCDate() + days)
    return parsed.toISOString().slice(0, 10)
}

/**
 * Expiry is a comparison, never a stored state: a document read a second
 * after its expiry date is expired whether or not any sweep has run.
 */
export function isExpired(doc: CurrentDoc, on: IsoDate): boolean {
    return doc.expiresAt !== null && doc.expiresAt < on
}

/** Approved and still valid today. */
export function isValid(doc: CurrentDoc, on: IsoDate): boolean {
    return doc.status === "approved" && !isExpired(doc, on)
}

const satisfying = (docs: CurrentDoc[], requirement: DocRequirement) =>
    docs.filter((doc) => requirement.anyOf.includes(doc.type))

/** How many required slots are approved and valid, out of how many. */
export function docProgress(
    kind: KycSubjectKind,
    docs: CurrentDoc[],
    on: IsoDate,
): { approved: number; required: number } {
    const requirements = REQUIRED_DOCS[kind]

    return {
        approved: requirements.filter((requirement) =>
            satisfying(docs, requirement).some((doc) => isValid(doc, on)),
        ).length,
        required: requirements.length,
    }
}

/** Required slots whose valid document expires within its warning window. */
export function expiringSoon(
    kind: KycSubjectKind,
    docs: CurrentDoc[],
    on: IsoDate,
): CurrentDoc[] {
    return REQUIRED_DOCS[kind].flatMap((requirement) => {
        const horizon = addDays(on, warnDays(requirement))

        return satisfying(docs, requirement).filter(
            (doc) =>
                isValid(doc, on) && doc.expiresAt !== null && doc.expiresAt <= horizon,
        )
    })
}

/**
 * The single owner of `kycStatus`.
 *
 * - `suspended` overrides everything — it is a deliberate admin action.
 * - `expired` outranks `verified`: every slot was approved, but one has run out.
 * - `rejected` outranks `pending-review`: the partner has something to fix.
 * - `draft` means at least one required slot has nothing in it at all.
 */
export function deriveKycStatus(
    kind: KycSubjectKind,
    docs: CurrentDoc[],
    opts: { suspended: boolean },
    on: IsoDate,
): KycStatus {
    if (opts.suspended) return "suspended"

    const requirements = REQUIRED_DOCS[kind]
    const slots = requirements.map((requirement) => satisfying(docs, requirement))

    if (slots.some((slot) => slot.length === 0)) return "draft"

    // A slot the partner must resubmit: everything in it was turned down
    if (slots.some((slot) => slot.every((doc) => doc.status === "rejected"))) return "rejected"

    if (slots.some((slot) => !slot.some((doc) => doc.status === "approved"))) return "pending-review"

    // Every slot has an approved document; the only question left is expiry
    return slots.some((slot) => !slot.some((doc) => isValid(doc, on))) ? "expired" : "verified"
}
