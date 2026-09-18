import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { user } from "@workspace/db/users";
import {
    KYC_DOCUMENT_TYPE,
    KYC_SUBJECT_TYPE,
    KycPagesSchema,
    type KycDocumentStatus,
    type KycDocumentType,
    type KycStatus,
    type KycSubjectType,
    type OrderDispatchSubject,
} from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure } from "@workspace/trpc/tenant";

import { isValid, today } from "@workspace/domain/kyc/derive";
import { withProxiedPages } from "@workspace/domain/kyc/file-access";
import { CONTRACT_DOC, subjectKind } from "@workspace/domain/kyc/requirements";
import { currentDocuments, loadSubject, type Subject } from "@workspace/domain/kyc/subjects";
import { uploadKycDocument } from "@workspace/domain/kyc/upload";

/**
 * The papers of a company itself and of its own drivers and vehicles, from
 * the portal.
 *
 * The KYC store was Admin's alone until dispatch started demanding papers
 * before a truck may load: a carrier that cannot file a licence itself
 * cannot dispatch, so the same store is opened here — strictly to the
 * subjects in its own registry and to its own company row, which is what
 * every procedure below checks before it looks at anything. Review stays
 * Appload's, and so does the signed contract: Appload files it after
 * signature, so `upload` refuses that one type.
 */

type Db = typeof Database;

const VEHICLE_TABLE = { truck, trailer, link } as const;

// The company itself, its drivers and its vehicles: no other organization's
// papers are reachable from here, and `tenantSubject` is what enforces that
const subjectType = z.enum(KYC_SUBJECT_TYPE);
const documentType = z.enum(KYC_DOCUMENT_TYPE);

// Calendar day, matching the pg `date` columns
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE");

/** One paper of a rig subject, as the dispatch dialog lists it. */
export type RigPaper = {
    id: string;
    type: KycDocumentType;
    status: KycDocumentStatus;
    expiresAt: string | null;
};

/**
 * One subject of a rig and what is on file for it. Deliberately flat: the
 * dispatch dialog renders it per pick, and the readiness rules read it
 * without having to know how a driver differs from a trailer.
 */
export type RigPaperSubject = {
    kind: OrderDispatchSubject;
    subjectId: string;
    /** The driver's name, or the vehicle's plate */
    label: string;
    kycStatus: KycStatus;
    docs: RigPaper[];
};

type SubjectRow = { id: string; kycStatus: KycStatus; label: string } | undefined;

/**
 * The subject's own row, scoped to the tenant. Two shapes of one question: a
 * driver's label is on the account behind it, a vehicle's on its own row.
 */
async function loadRow(
    db: Db,
    tenantId: string,
    kind: OrderDispatchSubject,
    id: string,
): Promise<SubjectRow> {
    if (kind === "driver") {
        const [row] = await db
            .select({ id: driver.id, kycStatus: driver.kycStatus, label: user.name })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(and(eq(driver.id, id), eq(driver.carrierId, tenantId)))
            .limit(1);

        return row;
    }

    const table = VEHICLE_TABLE[kind];

    const [row] = await db
        .select({ id: table.id, kycStatus: table.kycStatus, label: table.regPlate })
        .from(table)
        .where(and(eq(table.id, id), eq(table.carrierId, tenantId)))
        .limit(1);

    return row;
}

/**
 * The tenant's own subject, or NOT_FOUND — never an id from input on its
 * own. The row is scoped by `carrierId` in the same query that reads it,
 * which is the ownership rule `tenantOwnsSubject` states, without a second
 * round trip to ask it. The two say the same thing in two places: change one
 * — to exclude suspended subjects, say — and this one has to follow.
 */
async function ownedSubject(
    db: Db,
    tenantId: string,
    kind: OrderDispatchSubject,
    id: string,
): Promise<{ subject: Subject; label: string }> {
    const row = await loadRow(db, tenantId, kind, id);

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    return {
        subject: {
            subjectType: kind,
            subjectId: row.id,
            kind: subjectKind(kind),
            kycStatus: row.kycStatus,
            carrierId: tenantId,
        },
        label: row.label,
    };
}

/**
 * Any subject the tenant may file papers for: its own company, or a driver
 * or vehicle in its own registry.
 *
 * The organization's id IS its tenancy, so the one from input is only ever
 * compared with the gate's — a subject that is not this company is NOT_FOUND
 * exactly as another carrier's truck is. Its kind, and with it the checklist
 * the upload is validated against, comes off the company row rather than
 * from input.
 */
async function tenantSubject(
    db: Db,
    tenantId: string,
    type: KycSubjectType,
    id: string,
): Promise<Subject> {
    if (type !== "organization") {
        return (await ownedSubject(db, tenantId, type, id)).subject;
    }

    if (id !== tenantId) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    return loadSubject(db, "organization", tenantId);
}

export const kycRouter = createTRPCRouter({
    /** The live document set for one of the tenant's subjects. */
    documents: authorizedTenantProcedure("kyc", ["read"])
        .input(z.object({ subjectType, subjectId: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const subject = await tenantSubject(
                ctx.db,
                ctx.tenant.organizationId,
                input.subjectType,
                input.subjectId,
            );

            const documents = await currentDocuments(ctx.db, subject);

            // Storage URLs are world-readable, so they stop here: the client
            // gets same-origin hrefs into /api/kyc/file, which re-checks who
            // is asking on every page fetch.
            //
            // The row is projected rather than returned whole: the review
            // trail on it — who looked, when, what it superseded, who
            // withdrew it — is Appload's, not the carrier's.
            return {
                subject,
                documents: documents.map(withProxiedPages).map((doc) => ({
                    id: doc.id,
                    type: doc.type,
                    status: doc.status,
                    issuedAt: doc.issuedAt,
                    expiresAt: doc.expiresAt,
                    documentNumber: doc.documentNumber,
                    rejectionReason: doc.rejectionReason,
                    pages: doc.pages,
                    createdAt: doc.createdAt,
                })),
            };
        }),

    /**
     * Files a paper for one of the tenant's own subjects. Same door Admin's
     * upload goes through, so a carrier's submission is superseded, derived
     * and recorded exactly as a reviewer's would be — and lands as `pending`
     * for Appload to review.
     *
     * Which types a subject may hold is `uploadKycDocument`'s check against
     * REQUIRED_DOCS for its kind; the contract is the one exception refused
     * here, because it is a paper Appload files, not one a partner sends.
     */
    upload: authorizedTenantProcedure("kyc", ["upload"])
        .input(z.object({
            subjectType,
            subjectId: z.string().nonempty(),
            type: documentType,
            pages: KycPagesSchema,
            issuedAt: isoDate.optional(),
            expiresAt: isoDate.optional(),
            documentNumber: z.string().trim().max(60).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // The contract is countersigned by Appload and filed by Appload;
            // a partner reads where it stands but never sends one
            if (input.type === CONTRACT_DOC) {
                throw new TRPCError({ code: "FORBIDDEN", message: "CONTRACT_APPLOAD_ONLY" });
            }

            const subject = await tenantSubject(
                ctx.db,
                ctx.tenant.organizationId,
                input.subjectType,
                input.subjectId,
            );

            // Any member may file the company's papers, but never over one
            // that already stands: an upload supersedes, so a second NUIT
            // sent over an approved one would drop the slot back to pending
            // and the company out of `verified` — unbookable until a
            // reviewer looks again. Resubmitting a rejected or expired
            // paper, which is what the card offers, stays open.
            if (subject.subjectType === "organization") {
                const standing = (await currentDocuments(ctx.db, subject))
                    .find((doc) => doc.type === input.type);

                if (standing && isValid(standing, today())) {
                    throw new TRPCError({ code: "CONFLICT", message: "DOCUMENT_ALREADY_ON_FILE" });
                }
            }

            return uploadKycDocument(ctx.db, {
                subject,
                type: input.type,
                pages: input.pages,
                issuedAt: input.issuedAt,
                expiresAt: input.expiresAt,
                documentNumber: input.documentNumber,
                uploadedBy: ctx.tenant.userId,
            });
        }),

    /**
     * What is on file for a rig being dispatched — the driver and whichever
     * vehicles were picked. One read for the whole pick, so the dispatch
     * dialog can name the gaps before the move is attempted.
     */
    rigPapers: authorizedTenantProcedure("kyc", ["read"])
        .input(z.object({
            driverId: z.string().nullish(),
            truckId: z.string().nullish(),
            trailerId: z.string().nullish(),
            linkId: z.string().nullish(),
        }))
        .query(async ({ ctx, input }): Promise<RigPaperSubject[]> => {
            const picked = ([
                ["driver", input.driverId],
                ["truck", input.truckId],
                ["trailer", input.trailerId],
                ["link", input.linkId],
            ] as const).filter((entry): entry is [OrderDispatchSubject, string] => Boolean(entry[1]));

            return Promise.all(picked.map(async ([kind, id]) => {
                const { subject, label } = await ownedSubject(ctx.db, ctx.tenant.organizationId, kind, id);
                const docs = await currentDocuments(ctx.db, subject);

                return {
                    kind,
                    subjectId: subject.subjectId,
                    label,
                    kycStatus: subject.kycStatus,
                    // Pages are left out: this says what is held and whether
                    // it stands, not what it looks like
                    docs: docs.map((doc) => ({
                        id: doc.id,
                        type: doc.type,
                        status: doc.status,
                        expiresAt: doc.expiresAt,
                    })),
                };
            }));
        }),
});
