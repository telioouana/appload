import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { user } from "@workspace/db/users";
import {
    KYC_DOCUMENT_TYPE,
    ORDER_DISPATCH_SUBJECT,
    KycPagesSchema,
    type KycDocumentStatus,
    type KycDocumentType,
    type KycStatus,
    type OrderDispatchSubject,
} from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure } from "@workspace/trpc/tenant";

import { withProxiedPages } from "@workspace/domain/kyc/file-access";
import { subjectKind } from "@workspace/domain/kyc/requirements";
import { currentDocuments, type Subject } from "@workspace/domain/kyc/subjects";
import { uploadKycDocument } from "@workspace/domain/kyc/upload";

/**
 * The papers of a company's own drivers and vehicles, from the portal.
 *
 * The KYC store was Admin's alone until dispatch started demanding papers
 * before a truck may load: a carrier that cannot file a licence itself
 * cannot dispatch, so the same store is opened here — strictly to the
 * subjects in its own registry, which is what every procedure below checks
 * before it looks at anything. Review stays Appload's.
 */

type Db = typeof Database;

const VEHICLE_TABLE = { truck, trailer, link } as const;

// Drivers and vehicles only: the company's own contract is filed from
// Settings, and no other organization's papers are reachable from here
const subjectType = z.enum(ORDER_DISPATCH_SUBJECT);
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

export const kycRouter = createTRPCRouter({
    /** The live document set for one of the tenant's subjects. */
    documents: authorizedTenantProcedure("kyc", ["read"])
        .input(z.object({ subjectType, subjectId: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const { subject } = await ownedSubject(
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
            const { subject } = await ownedSubject(
                ctx.db,
                ctx.tenant.organizationId,
                input.subjectType,
                input.subjectId,
            );

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
