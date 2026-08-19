import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";

import { organization } from "@workspace/db/users";
import { driver } from "@workspace/db/fleet";
import { kycDocument } from "@workspace/db/kyc-documents";
import {
    KYC_DOCUMENT_TYPE,
    KYC_SUBJECT_TYPE,
    KycPagesSchema,
    type KycStatus,
    type KycSubjectType,
} from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { loadOrderGate } from "@/lib/kyc/order-gate";
import { kycActionRequirements } from "@/lib/kyc/transitions";
import { isKycUrl, withProxiedPages } from "@/lib/kyc/file-access";
import {
    OWNERSHIP_DOC,
    requirementFor,
} from "@/lib/kyc/requirements";
// Subject loading and status derivation are shared with the expiry cron —
// deriveKycStatus must keep exactly one caller-facing owner
import {
    VEHICLE_TABLE,
    currentDocuments,
    isVehicle,
    loadSubject,
    toCurrentDoc,
    writeDerivedStatus,
    type Subject,
} from "@/lib/kyc/subjects";

const subjectType = z.enum(KYC_SUBJECT_TYPE);
const documentType = z.enum(KYC_DOCUMENT_TYPE);

// Calendar day, matching the pg `date` columns
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE");

type Db = typeof Database;

/**
 * Uploads must come from our own KYC bucket, filed under the subject they
 * are being attached to. The host check alone would let a caller file some
 * other subject's ID scan — or an order document — as this subject's
 * paperwork, which a reviewer would then approve in good faith. The bucket
 * builds the path from the same three values (see the kycFiles bucket in
 * packages/edgestore/src/server.ts), so requiring them to reappear in the
 * URL ties the record to its file.
 */
function assertKycUrl(url: string, subjectType: KycSubjectType, subjectId: string) {
    if (!isKycUrl(url, subjectType, subjectId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

export const kycRouter = createTRPCRouter({
    /** The live document set for one subject, for the review sheet. */
    documents: authorizedProcedure("kyc", ["read"])
        .input(z.object({ subjectType, subjectId: z.string().nonempty() }))
        .query(async ({ ctx, input }) => {
            const subject = await loadSubject(ctx.db, input.subjectType, input.subjectId);
            const documents = await currentDocuments(ctx.db, subject);

            // The reviewer compares the owner on a vehicle's proof of
            // ownership against this, so it travels with the documents
            let carrierNuit: string | null = null;

            if (isVehicle(input.subjectType) && subject.carrierId) {
                const [carrier] = await ctx.db
                    .select({ nuit: organization.nuit })
                    .from(organization)
                    .where(eq(organization.id, subject.carrierId));

                carrierNuit = carrier?.nuit ?? null;
            }

            // Storage URLs are world-readable, so they stop here: the reviewer
            // gets same-origin hrefs into /api/kyc/file, which re-checks the
            // session on every page fetch
            return { subject, documents: documents.map(withProxiedPages), carrierNuit };
        }),

    /** Full history for one slot, newest first — including rejected rows. */
    history: authorizedProcedure("kyc", ["read"])
        .input(z.object({
            subjectType,
            subjectId: z.string().nonempty(),
            type: documentType,
        }))
        .query(async ({ ctx, input }) => {
            const rows = await ctx.db
                .select()
                .from(kycDocument)
                .where(and(
                    eq(kycDocument.subjectType, input.subjectType),
                    eq(kycDocument.subjectId, input.subjectId),
                    eq(kycDocument.type, input.type),
                ))
                .orderBy(desc(kycDocument.createdAt));

            return rows.map(withProxiedPages);
        }),

    /**
     * Adds a document. Replacing an existing slot supersedes it rather than
     * updating it, so a rejection and its resubmission both stay on record.
     */
    upload: authorizedProcedure("kyc", ["upload"])
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
            const subject = await loadSubject(ctx.db, input.subjectType, input.subjectId);

            if (!requirementFor(subject.kind, input.type)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "DOCUMENT_NOT_APPLICABLE" });
            }

            for (const page of input.pages) {
                assertKycUrl(page.url, input.subjectType, input.subjectId);
            }

            const existing = await currentDocuments(ctx.db, subject);
            const replaced = existing.find((doc) => doc.type === input.type);

            const [document] = await ctx.db
                .insert(kycDocument)
                .values({
                    subjectType: input.subjectType,
                    subjectId: input.subjectId,
                    type: input.type,
                    pages: input.pages,
                    issuedAt: input.issuedAt ?? null,
                    expiresAt: input.expiresAt ?? null,
                    documentNumber: input.documentNumber ?? null,
                    supersedesId: replaced?.id ?? null,
                    uploadedBy: ctx.session.user.id,
                })
                .returning();

            if (!document) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            const next = existing
                .filter((doc) => doc.type !== input.type)
                .map(toCurrentDoc)
                .concat(toCurrentDoc(document));

            const status = await writeDerivedStatus(ctx.db, subject, next);

            return { document: withProxiedPages(document), kycStatus: status };
        }),

    /**
     * Decides one document. Approval of an expiring document without an
     * expiry date is refused here, not merely disabled in the UI.
     *
     * Reviewing a proof of ownership also transcribes who the vehicle
     * belongs to; if that is not the carrier, the carrier is flagged as a
     * High-Risk Subcontractor in the same request, so the flag can never
     * drift from the finding that caused it.
     */
    review: authorizedProcedure("kyc", ["review"])
        .input(z.object({
            documentId: z.string().nonempty(),
            decision: z.enum(["approved", "rejected"]),
            expiresAt: isoDate.optional(),
            issuedAt: isoDate.optional(),
            documentNumber: z.string().trim().max(60).optional(),
            rejectionReason: z.string().trim().min(1).max(1000).optional(),
            ownerName: z.string().trim().max(200).optional(),
            ownerNuit: z.string().trim().max(20).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const [document] = await ctx.db
                .select()
                .from(kycDocument)
                .where(eq(kycDocument.id, input.documentId));

            if (!document || document.deletedAt !== null) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const subject = await loadSubject(ctx.db, document.subjectType, document.subjectId);
            const requirement = requirementFor(subject.kind, document.type);

            const verdict = kycActionRequirements(
                input.decision === "approved" ? "review-approve" : "review-reject",
                {
                    role: ctx.staff.role,
                    documentStatus: document.status,
                    needsExpiry: requirement?.expires ?? false,
                },
            );

            if (!verdict.ok) {
                throw new TRPCError({
                    code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "CONFLICT",
                    message: verdict.code,
                });
            }

            const expiresAt = input.expiresAt ?? document.expiresAt;

            if (verdict.requirements.includes("expiry") && !expiresAt) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "EXPIRY_REQUIRED" });
            }
            if (verdict.requirements.includes("reason") && !input.rejectionReason) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "REASON_REQUIRED" });
            }

            // Approving a proof of ownership is what raises the High-Risk
            // Subcontractor flag, so the transcription is resolved — and
            // every way it can fail is raised — before the first write. The
            // driver has no transactions, and a decided document is final:
            // a throw after the update would strand an approved document
            // with no owner recorded and no flag, unrecoverable through the API.
            const ownershipParams =
                document.type === OWNERSHIP_DOC &&
                    input.decision === "approved" &&
                    isVehicle(document.subjectType)
                    ? {
                        subjectType: document.subjectType,
                        subjectId: document.subjectId,
                        carrierId: subject.carrierId,
                        ownerName: input.ownerName ?? null,
                        ownerNuit: input.ownerNuit ?? null,
                        actorId: ctx.session.user.id,
                    }
                    : null;

            const plan = ownershipParams
                ? await resolveOwnership(ctx.db, ownershipParams)
                : null;

            const [reviewed] = await ctx.db
                .update(kycDocument)
                .set({
                    status: input.decision,
                    expiresAt: input.decision === "approved" ? expiresAt : document.expiresAt,
                    issuedAt: input.issuedAt ?? document.issuedAt,
                    documentNumber: input.documentNumber ?? document.documentNumber,
                    rejectionReason: input.decision === "rejected" ? input.rejectionReason ?? null : null,
                    reviewedBy: ctx.session.user.id,
                    reviewedAt: new Date(),
                })
                // Only a pending row may be decided — guards a double submit
                .where(and(eq(kycDocument.id, input.documentId), eq(kycDocument.status, "pending")))
                .returning();

            if (!reviewed) {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_REVIEWED" });
            }

            if (ownershipParams && plan) {
                await writeOwnership(ctx.db, ownershipParams, plan);
            }

            const docs = await currentDocuments(ctx.db, subject);
            const status = await writeDerivedStatus(ctx.db, subject, docs.map(toCurrentDoc));

            return {
                document: withProxiedPages(reviewed),
                kycStatus: status,
                ownership: plan
                    ? { status: plan.status, carrierFlagged: !plan.matches }
                    : null,
            };
        }),

    /**
     * The verification verdict for everyone on one order.
     *
     * The order form calls this to render its banner; `order.create`,
     * `order.updateDeal` and `order.transition` call the same loader to
     * enforce it. One decision, two surfaces — the client renders, the
     * server decides.
     */
    orderGate: authorizedProcedure("kyc", ["read"])
        .input(z.object({
            carrierId: z.string().nonempty(),
            driverId: z.string().nullish(),
            truckPlate: z.string().nullish(),
            trailerPlate: z.string().nullish(),
            linkPlate: z.string().nullish(),
        }))
        .query(({ ctx, input }) => loadOrderGate(ctx.db, input)),

    flagRisk: authorizedProcedure("risk", ["flag"])
        .input(z.object({
            organizationId: z.string().nonempty(),
            level: z.enum(["watch", "high"]),
            reason: z.string().trim().min(1).max(1000),
        }))
        .mutation(async ({ ctx, input }) => {
            const verdict = kycActionRequirements("flag-risk", { role: ctx.staff.role });

            if (!verdict.ok) {
                throw new TRPCError({ code: "FORBIDDEN", message: verdict.code });
            }

            const [updated] = await ctx.db
                .update(organization)
                .set({
                    riskLevel: input.level,
                    riskReason: input.reason,
                    riskFlaggedAt: new Date(),
                    riskFlaggedBy: ctx.session.user.id,
                })
                .where(eq(organization.id, input.organizationId))
                .returning({ id: organization.id, riskLevel: organization.riskLevel });

            if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            return updated;
        }),

    clearRisk: authorizedProcedure("risk", ["clear"])
        .input(z.object({
            organizationId: z.string().nonempty(),
            note: z.string().trim().min(1).max(1000),
        }))
        .mutation(async ({ ctx, input }) => {
            const [current] = await ctx.db
                .select({ riskLevel: organization.riskLevel })
                .from(organization)
                .where(eq(organization.id, input.organizationId));

            if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const verdict = kycActionRequirements("clear-risk", {
                role: ctx.staff.role,
                riskLevel: current.riskLevel,
            });

            if (!verdict.ok) {
                throw new TRPCError({
                    code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "CONFLICT",
                    message: verdict.code,
                });
            }

            const [updated] = await ctx.db
                .update(organization)
                .set({
                    riskLevel: "none",
                    // The clearing note replaces the finding it answers
                    riskReason: input.note,
                    riskFlaggedAt: new Date(),
                    riskFlaggedBy: ctx.session.user.id,
                })
                .where(eq(organization.id, input.organizationId))
                .returning({ id: organization.id, riskLevel: organization.riskLevel });

            return updated;
        }),

    /**
     * Suspension overrides the derived status entirely. Lifting it re-derives
     * from the documents rather than restoring the previous value, so a
     * partner whose papers expired while suspended does not come back verified.
     */
    suspend: authorizedProcedure("kyc", ["override"])
        .input(z.object({
            subjectType,
            subjectId: z.string().nonempty(),
            note: z.string().trim().min(1).max(1000),
        }))
        .mutation(async ({ ctx, input }) => {
            const subject = await loadSubject(ctx.db, input.subjectType, input.subjectId);

            const verdict = kycActionRequirements("suspend", {
                role: ctx.staff.role,
                status: subject.kycStatus,
            });

            if (!verdict.ok) {
                throw new TRPCError({
                    code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "CONFLICT",
                    message: verdict.code,
                });
            }

            await setStatus(ctx.db, subject, "suspended");

            return { kycStatus: "suspended" as const };
        }),

    unsuspend: authorizedProcedure("kyc", ["override"])
        .input(z.object({
            subjectType,
            subjectId: z.string().nonempty(),
            note: z.string().trim().min(1).max(1000),
        }))
        .mutation(async ({ ctx, input }) => {
            const subject = await loadSubject(ctx.db, input.subjectType, input.subjectId);

            const verdict = kycActionRequirements("unsuspend", {
                role: ctx.staff.role,
                status: subject.kycStatus,
            });

            if (!verdict.ok) {
                throw new TRPCError({
                    code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "CONFLICT",
                    message: verdict.code,
                });
            }

            const docs = await currentDocuments(ctx.db, subject);
            // Derive as if not suspended, but still compare against what is
            // stored — otherwise a subject whose papers derive back to
            // `draft` would silently keep its `suspended` column
            const status = await writeDerivedStatus(
                ctx.db,
                subject,
                docs.map(toCurrentDoc),
                { suspended: false },
            );

            return { kycStatus: status };
        }),
});

async function setStatus(db: Db, subject: Subject, status: KycStatus) {
    if (subject.subjectType === "organization") {
        await db.update(organization).set({ kycStatus: status }).where(eq(organization.id, subject.subjectId));
        return;
    }

    const table = subject.subjectType === "driver" ? driver : VEHICLE_TABLE[subject.subjectType];
    await db.update(table).set({ kycStatus: status }).where(eq(table.id, subject.subjectId));
}

type OwnershipParams = {
    subjectType: "truck" | "trailer" | "link"
    subjectId: string
    carrierId: string | null
    ownerName: string | null
    ownerNuit: string | null
    actorId: string
}

type OwnershipPlan = {
    status: "owner-verified" | "third-party"
    matches: boolean
    carrierId: string
    regPlate: string | null
}

/**
 * Decides who a vehicle belongs to. Every rejection this can produce happens
 * here, before anything is written: the driver has no transactions, so a
 * throw after the first write would leave a document approved with its
 * ownership never transcribed and its carrier never flagged — a state the
 * review mutation cannot re-enter, since a decided document is final.
 *
 * The comparison is on NUIT, not name: company names are typed by hand and
 * vary, tax numbers do not.
 */
async function resolveOwnership(db: Db, params: OwnershipParams): Promise<OwnershipPlan> {
    if (!params.carrierId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CARRIER_UNKNOWN" });
    }
    if (!params.ownerNuit) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OWNER_NUIT_REQUIRED" });
    }

    const table = VEHICLE_TABLE[params.subjectType];

    const [[carrier], [vehicle]] = await Promise.all([
        db.select({ nuit: organization.nuit })
            .from(organization)
            .where(eq(organization.id, params.carrierId)),
        db.select({ regPlate: table.regPlate })
            .from(table)
            .where(eq(table.id, params.subjectId)),
    ]);

    if (!carrier || !vehicle) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    const normalize = (value: string) => value.replace(/\s+/g, "");
    const matches = normalize(carrier.nuit) === normalize(params.ownerNuit);

    return {
        status: matches ? "owner-verified" : "third-party",
        matches,
        carrierId: params.carrierId,
        regPlate: vehicle.regPlate,
    };
}

/**
 * Writes a resolved ownership decision. On a mismatch the vehicle row and
 * the carrier's risk flag go out in one batch, so a flag whose reason has to
 * be reconstructed later can never exist.
 */
async function writeOwnership(db: Db, params: OwnershipParams, plan: OwnershipPlan) {
    const table = VEHICLE_TABLE[params.subjectType];

    const vehicleWrite = db
        .update(table)
        .set({
            ownershipStatus: plan.status,
            ownerName: params.ownerName,
            ownerNuit: params.ownerNuit,
        })
        .where(eq(table.id, params.subjectId));

    if (plan.matches) {
        await vehicleWrite;
        return;
    }

    await db.batch([
        vehicleWrite,
        db.update(organization)
            .set({
                riskLevel: "high",
                riskReason: `HIGH_RISK_SUBCONTRACTOR: ${params.subjectType} ${plan.regPlate ?? params.subjectId} is owned by third party (NUIT ${params.ownerNuit})`,
                riskFlaggedAt: new Date(),
                riskFlaggedBy: params.actorId,
            })
            .where(eq(organization.id, plan.carrierId)),
    ]);
}
