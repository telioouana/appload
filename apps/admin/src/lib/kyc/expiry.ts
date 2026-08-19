import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { kycDocument } from "@workspace/db/kyc-documents";
import type { KycSubjectType } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { addDays, expiringSoon, today, type IsoDate } from "@/lib/kyc/derive";
import { currentDocuments, loadSubject, toCurrentDoc, writeDerivedStatus } from "@/lib/kyc/subjects";

/**
 * The daily expiry sweep.
 *
 * Expiry is a read-time comparison (see `isExpired`), so verification
 * decisions are always correct even if this never runs. What the sweep adds
 * is the stored `kycStatus` catching up — list filters and the order-form
 * gate read the column, and no mutation fires on the day a document simply
 * runs out. It also counts what is about to expire, for the dashboard.
 *
 * Recomputation goes through `writeDerivedStatus`, never hand-written SQL:
 * `deriveKycStatus` owns the value in every path.
 */

/** Horizons surfaced as warnings, per the KYC design doc. */
export const WARN_HORIZONS = [30, 7] as const;

export type ExpirySweepSummary = {
    on: IsoDate;
    /** Subjects whose stored status was stale and has been rewritten. */
    changed: { subjectType: KycSubjectType; subjectId: string; from: string; to: string }[];
    checked: number;
    expiringSoon: Record<(typeof WARN_HORIZONS)[number], number>;
};

/**
 * Every subject holding a live document that has expired or expires within
 * the widest warning horizon. Approved-only: a pending or rejected document
 * running out changes nothing about a status that never counted it.
 */
async function subjectsToCheck(db: typeof Database, horizon: IsoDate) {
    return db
        .selectDistinct({
            subjectType: kycDocument.subjectType,
            subjectId: kycDocument.subjectId,
        })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.status, "approved"),
            isNull(kycDocument.deletedAt),
            sql`${kycDocument.expiresAt} is not null`,
            lte(kycDocument.expiresAt, horizon),
        ));
}

export async function runExpirySweep(
    db: typeof Database,
    on: IsoDate = today(),
): Promise<ExpirySweepSummary> {
    const widest = Math.max(...WARN_HORIZONS);
    const candidates = await subjectsToCheck(db, addDays(on, widest));

    const summary: ExpirySweepSummary = {
        on,
        changed: [],
        checked: candidates.length,
        expiringSoon: { 30: 0, 7: 0 },
    };

    for (const candidate of candidates) {
        // A document can outlive its subject row (no FK by design) — skip
        // those rather than fail the whole sweep
        const subject = await loadSubject(db, candidate.subjectType, candidate.subjectId)
            .catch(() => null);

        if (!subject) continue;

        const docs = (await currentDocuments(db, subject)).map(toCurrentDoc);
        const before = subject.kycStatus;
        // Pinned to the day the candidates were selected for, so a sweep
        // that runs across midnight cannot judge half its subjects against
        // a different date than it queried them with
        const after = await writeDerivedStatus(db, subject, docs, { on });

        if (after !== before) {
            summary.changed.push({
                subjectType: subject.subjectType,
                subjectId: subject.subjectId,
                from: before,
                to: after,
            });
        }

        // Count each subject once per horizon it falls inside
        for (const days of WARN_HORIZONS) {
            if (expiringSoon(subject.kind, docs, on).some(
                (doc) => doc.expiresAt !== null && doc.expiresAt <= addDays(on, days),
            )) {
                summary.expiringSoon[days]++;
            }
        }
    }

    return summary;
}
