import { date, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
    KYC_DOCUMENT_STATUS,
    KYC_DOCUMENT_TYPE,
    KYC_SUBJECT_TYPE,
} from "@workspace/db/types";

import type { KycPage } from "@workspace/db/types";

/**
 * One polymorphic table for every verification document in the platform:
 * company papers (NUIT, ID card, commercial certificate, alvará, the signed
 * carrier contract), driver licenses, and vehicle booklets/ownership proofs.
 *
 * Rows are append-only. A review sets the decision fields once; a
 * resubmission inserts a fresh `pending` row pointing at the one it replaces
 * via `supersedesId`, so the chain itself is the audit history and a rejected
 * document is never overwritten.
 *
 * `subjectType`/`subjectId` carry no foreign key on purpose — five different
 * tables can own a document, and the same trade activity_log makes applies:
 * referential integrity is enforced in the tRPC layer, and the trail survives
 * a cascade delete of its subject.
 */
export const kycDocument = pgTable(
    "kyc_document",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        subjectType: text("subject_type", { enum: KYC_SUBJECT_TYPE }).notNull(),
        subjectId: text("subject_id").notNull(),
        type: text("type", { enum: KYC_DOCUMENT_TYPE }).notNull(),

        // The scans of this one document, in page order
        pages: jsonb("pages").$type<KycPage[]>().notNull(),

        status: text("status", { enum: KYC_DOCUMENT_STATUS }).default("pending").notNull(),

        // Calendar days, not instants: a licence expires on a date, not at a
        // timezone-dependent moment. `expired` is never stored — it is
        // derived by comparing expiresAt to today (see lib/kyc/derive.ts).
        issuedAt: date("issued_at"),
        expiresAt: date("expires_at"),
        documentNumber: text("document_number"),

        // Snapshots, no FK — the decision trail outlives the reviewer's account
        reviewedBy: text("reviewed_by"),
        reviewedAt: timestamp("reviewed_at"),
        rejectionReason: text("rejection_reason"),

        // The row this one replaces; null for a first submission
        supersedesId: text("supersedes_id"),

        uploadedBy: text("uploaded_by").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),

        // Verification records are never hard-deleted
        deletedAt: timestamp("deleted_at"),
        deletedBy: text("deleted_by"),
    },
    (table) => [
        index("kyc_document_subject_idx").on(table.subjectType, table.subjectId),
        index("kyc_document_status_idx").on(table.status),
        // Drives the "expiring soon" queries and the daily expiry sweep
        index("kyc_document_expiry_idx").on(table.expiresAt),
    ],
);

export type KycDocument = typeof kycDocument.$inferSelect
export type CreateKycDocument = typeof kycDocument.$inferInsert
