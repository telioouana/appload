import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import { organization } from "@workspace/db/users";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { kycDocument, type KycDocument } from "@workspace/db/kyc-documents";
import type { KycStatus, KycSubjectKind, KycSubjectType } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { deriveKycStatus, today, type CurrentDoc, type IsoDate } from "@/lib/kyc/derive";
import { subjectKind } from "@/lib/kyc/requirements";

/**
 * Subject loading and status derivation, shared by the KYC router and the
 * daily expiry cron. `deriveKycStatus` owns the value of `kycStatus`; this
 * module is the only place that writes it, so the two callers can never
 * drift into two different notions of "verified".
 */

type Db = typeof Database;

export const VEHICLE_TABLE = { truck, trailer, link } as const;

/** A vehicle subject — the only kind that carries ownership. */
export const isVehicle = (type: KycSubjectType): type is "truck" | "trailer" | "link" =>
    type === "truck" || type === "trailer" || type === "link";

export type Subject = {
    subjectType: KycSubjectType
    subjectId: string
    kind: KycSubjectKind
    kycStatus: KycStatus
    /** The organization whose risk profile this subject rolls up into */
    carrierId: string | null
}

export async function loadSubject(
    db: Db,
    type: KycSubjectType,
    id: string,
): Promise<Subject> {
    if (type === "organization") {
        const [row] = await db
            .select({ id: organization.id, type: organization.type, kycStatus: organization.kycStatus })
            .from(organization)
            .where(eq(organization.id, id));

        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

        return {
            subjectType: type,
            subjectId: row.id,
            kind: subjectKind(type, row.type),
            kycStatus: row.kycStatus,
            // A carrier's own risk flag lives on its own row
            carrierId: row.type === "carrier" ? row.id : null,
        };
    }

    const table = type === "driver" ? driver : VEHICLE_TABLE[type];

    const [row] = await db
        .select({ id: table.id, carrierId: table.carrierId, kycStatus: table.kycStatus })
        .from(table)
        .where(eq(table.id, id));

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    return {
        subjectType: type,
        subjectId: row.id,
        kind: subjectKind(type),
        kycStatus: row.kycStatus,
        carrierId: row.carrierId,
    };
}

/**
 * The live document set: one row per type — the most recent submission that
 * nothing else supersedes. Superseded and soft-deleted rows stay in the
 * table as history but never count towards verification.
 */
export async function currentDocuments(db: Db, subject: Subject): Promise<KycDocument[]> {
    const rows = await db
        .select()
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, subject.subjectType),
            eq(kycDocument.subjectId, subject.subjectId),
            isNull(kycDocument.deletedAt),
        ))
        .orderBy(desc(kycDocument.createdAt));

    const superseded = new Set(
        rows.map((row) => row.supersedesId).filter((id): id is string => id !== null),
    );

    const current = new Map<string, KycDocument>();

    // Rows arrive newest first, so the first survivor of each type wins
    for (const row of rows) {
        if (superseded.has(row.id) || current.has(row.type)) continue;
        current.set(row.type, row);
    }

    return [...current.values()];
}

export const toCurrentDoc = (doc: KycDocument): CurrentDoc => ({
    type: doc.type,
    status: doc.status,
    expiresAt: doc.expiresAt,
});

/**
 * Writes the derived verification status back to the subject's own table.
 * `kycStatus` is stored so list pages can filter on it, but deriveKycStatus
 * owns the value — this runs after every change to the document set, and
 * daily from the expiry cron for the one transition no mutation triggers.
 *
 * `opts.suspended` exists because lifting a suspension has to derive as if
 * the subject were not suspended while still comparing against what is
 * actually stored. Passing a doctored `subject` would do both at once: the
 * derivation would be right and the dirty check below would silently skip
 * the write whenever the two happened to agree.
 *
 * `opts.on` lets the caller pin the day — the cron sweeps against the date
 * it selected candidates for, not whatever the clock says mid-run.
 */
export async function writeDerivedStatus(
    db: Db,
    subject: Subject,
    docs: CurrentDoc[],
    opts?: { suspended?: boolean; on?: IsoDate },
) {
    // A suspension is a deliberate admin action and outranks the documents
    const status = deriveKycStatus(
        subject.kind,
        docs,
        { suspended: opts?.suspended ?? subject.kycStatus === "suspended" },
        opts?.on ?? today(),
    );

    // Compared against what is stored, never against a caller's override
    if (status === subject.kycStatus) return status;

    if (subject.subjectType === "organization") {
        await db.update(organization).set({ kycStatus: status }).where(eq(organization.id, subject.subjectId));
    } else {
        const table = subject.subjectType === "driver" ? driver : VEHICLE_TABLE[subject.subjectType];
        await db.update(table).set({ kycStatus: status }).where(eq(table.id, subject.subjectId));
    }

    return status;
}
