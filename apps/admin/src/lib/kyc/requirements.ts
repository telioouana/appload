import { KYC_DOCUMENT_TYPE } from "@workspace/db/types";
import type { KycDocumentType, KycSubjectKind, KycSubjectType } from "@workspace/db/types";

/**
 * Which documents each kind of partner must produce, and which of them carry
 * an expiry date. Config as code: the business rules ("carriers need
 * everything a shipper needs plus a signed contract", "a driver may prove
 * identity with either a licence or an ID card") live here rather than
 * scattered through validation branches.
 *
 * Shared verbatim by the review UI and the server — the checklist the admin
 * sees and the gate the mutation applies are the same table.
 */
export type DocRequirement = {
    /** Any one of these document types satisfies the slot */
    anyOf: KycDocumentType[]
    /** The document is only approvable with an expiry date */
    expires: boolean
    /** Days before expiry at which the list pages start warning */
    warnDays?: number
}

const DEFAULT_WARN_DAYS = 30

export const REQUIRED_DOCS: Record<KycSubjectKind, DocRequirement[]> = {
    shipper: [
        { anyOf: ["nuit"], expires: false },
        { anyOf: ["id-card"], expires: true },
        { anyOf: ["commercial-certificate"], expires: false },
    ],
    carrier: [
        { anyOf: ["nuit"], expires: false },
        { anyOf: ["id-card"], expires: true },
        { anyOf: ["commercial-certificate"], expires: false },
        { anyOf: ["alvara"], expires: true },
        { anyOf: ["bank-letter"], expires: false },
        { anyOf: ["republic-bulletin"], expires: false },
        { anyOf: ["commercial-exercise"], expires: false },
        // Without this the carrier cannot operate at all, whatever else it holds
        { anyOf: ["signed-contract"], expires: true },
    ],
    driver: [
        { anyOf: ["driver-license", "id-card"], expires: true },
    ],
    truck: [
        { anyOf: ["vehicle-booklet"], expires: false },
        { anyOf: ["proof-of-ownership"], expires: false },
    ],
    trailer: [
        { anyOf: ["vehicle-booklet"], expires: false },
        { anyOf: ["proof-of-ownership"], expires: false },
    ],
    link: [
        { anyOf: ["vehicle-booklet"], expires: false },
        { anyOf: ["proof-of-ownership"], expires: false },
    ],
}

/** The document a carrier cannot operate without. */
export const CONTRACT_DOC: KycDocumentType = "signed-contract"

/** The document whose review transcribes vehicle ownership. */
export const OWNERSHIP_DOC: KycDocumentType = "proof-of-ownership"

/**
 * A subject's kind is its table, except for organizations where the shipper
 * and carrier document sets differ.
 */
export function subjectKind(
    subjectType: KycSubjectType,
    organizationType?: "shipper" | "carrier" | null,
): KycSubjectKind {
    if (subjectType !== "organization") return subjectType
    return organizationType === "carrier" ? "carrier" : "shipper"
}

/** Document types a subject of this kind may upload. */
export function allowedDocTypes(kind: KycSubjectKind): KycDocumentType[] {
    return REQUIRED_DOCS[kind].flatMap((requirement) => requirement.anyOf)
}

/** The requirement a given document type belongs to, if any. */
export function requirementFor(
    kind: KycSubjectKind,
    type: KycDocumentType,
): DocRequirement | undefined {
    return REQUIRED_DOCS[kind].find((requirement) => requirement.anyOf.includes(type))
}

/** Whether approving this document demands an expiry date. */
export function requiresExpiry(kind: KycSubjectKind, type: KycDocumentType): boolean {
    return requirementFor(kind, type)?.expires ?? false
}

export function warnDays(requirement: DocRequirement): number {
    return requirement.warnDays ?? DEFAULT_WARN_DAYS
}

/** Guards a hand-edited document type coming off the wire. */
export function isKycDocumentType(value: string): value is KycDocumentType {
    return (KYC_DOCUMENT_TYPE as readonly string[]).includes(value)
}
