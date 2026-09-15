import "server-only";

import { TRPCError } from "@trpc/server";

import { kycDocument, type KycDocument } from "@workspace/db/kyc-documents";
import type { KycDocumentType, KycPage, KycStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { isKycUrl, withProxiedPages } from "@workspace/domain/kyc/file-access";
import { requirementFor } from "@workspace/domain/kyc/requirements";
import {
    currentDocuments,
    toCurrentDoc,
    writeDerivedStatus,
    type Subject,
} from "@workspace/domain/kyc/subjects";

/**
 * Filing a verification document, shared by Admin's reviewer upload and the
 * portal's own (a carrier filing the papers of its own driver or vehicle).
 *
 * The two callers differ only in who is allowed to reach the subject — which
 * is their gate's business — so everything after that lives here: what the
 * subject may hold, where the file came from, the supersede chain and the
 * status that falls out of it. Two copies of this would be two answers to
 * "is this subject verified", which is exactly what `writeDerivedStatus`
 * exists to prevent.
 */

type Db = typeof Database;

export type UploadKycDocumentInput = {
    subject: Subject
    type: KycDocumentType
    pages: KycPage[]
    /** Calendar days, matching the pg `date` columns */
    issuedAt?: string
    expiresAt?: string
    documentNumber?: string
    /** The user id recorded on the row */
    uploadedBy: string
};

export type UploadKycDocumentResult = {
    document: KycDocument
    kycStatus: KycStatus
};

/**
 * Uploads must come from our own KYC bucket, filed under the subject they
 * are being attached to. The host check alone would let a caller file some
 * other subject's ID scan — or an order document — as this subject's
 * paperwork, which a reviewer would then approve in good faith. The bucket
 * builds the path from the same three values (see the kycFiles bucket in
 * packages/edgestore/src/server.ts), so requiring them to reappear in the
 * URL ties the record to its file.
 */
function assertKycUrl(url: string, subject: Subject) {
    if (!isKycUrl(url, subject.subjectType, subject.subjectId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

/**
 * Adds a document. Replacing an existing slot supersedes it rather than
 * updating it, so a rejection and its resubmission both stay on record.
 */
export async function uploadKycDocument(
    db: Db,
    input: UploadKycDocumentInput,
): Promise<UploadKycDocumentResult> {
    const { subject } = input;

    if (!requirementFor(subject.kind, input.type)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DOCUMENT_NOT_APPLICABLE" });
    }

    for (const page of input.pages) {
        assertKycUrl(page.url, subject);
    }

    const existing = await currentDocuments(db, subject);
    const replaced = existing.find((doc) => doc.type === input.type);

    const [document] = await db
        .insert(kycDocument)
        .values({
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            type: input.type,
            pages: input.pages,
            issuedAt: input.issuedAt ?? null,
            expiresAt: input.expiresAt ?? null,
            documentNumber: input.documentNumber ?? null,
            supersedesId: replaced?.id ?? null,
            uploadedBy: input.uploadedBy,
        })
        .returning();

    if (!document) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    }

    const next = existing
        .filter((doc) => doc.type !== input.type)
        .map(toCurrentDoc)
        .concat(toCurrentDoc(document));

    const status = await writeDerivedStatus(db, subject, next);

    return { document: withProxiedPages(document), kycStatus: status };
}
