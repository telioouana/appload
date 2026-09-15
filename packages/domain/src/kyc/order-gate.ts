import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";
import { isAuthorized } from "@workspace/auth/user-permissions";

import type { Actor } from "@workspace/domain/orders/actor";
import { today } from "@workspace/domain/kyc/derive";
import { currentDocuments, loadSubject, toCurrentDoc } from "@workspace/domain/kyc/subjects";
import { paperState } from "@workspace/domain/orders/dispatch-readiness";
import { loadRigSubjects } from "@workspace/domain/orders/dispatch-papers";
import {
    enforcementMode,
    evaluateOrderGate,
    gateFlagReason,
    type OrderGate,
    type SubjectFlag,
} from "@workspace/domain/kyc/enforcement";

type Db = typeof Database;

export type OrderParties = {
    carrierId: string
    driverId?: string | null
    truckPlate?: string | null
    trailerPlate?: string | null
    linkPlate?: string | null
};

/**
 * Loads the verification state of every party on an order and reduces it to
 * one verdict.
 *
 * Shared by the order form (which renders the verdict) and the order
 * mutations (which enforce it), so the banner a user sees and the guard the
 * server applies are the same decision — the client cannot be talked into
 * showing "all clear" for a booking the server would refuse.
 */
export async function loadOrderGate(db: Db, parties: OrderParties): Promise<OrderGate> {
    const [carrierRow] = await db
        .select({
            kycStatus: organization.kycStatus,
            riskLevel: organization.riskLevel,
            riskReason: organization.riskReason,
        })
        .from(organization)
        .where(eq(organization.id, parties.carrierId));

    if (!carrierRow) {
        // A carrier that does not exist cannot be eligible; the order
        // mutations reject the FK separately
        return evaluateOrderGate({
            mode: enforcementMode(),
            carrier: { kycStatus: "draft", riskLevel: "none", riskReason: null },
            carrierDocs: [],
            subjects: [],
            on: today(),
        });
    }

    const carrierSubject = await loadSubject(db, "organization", parties.carrierId);
    const carrierDocs = (await currentDocuments(db, carrierSubject)).map(toCurrentDoc);

    const subjects = await loadPartySubjects(db, parties);

    return evaluateOrderGate({
        mode: enforcementMode(),
        carrier: carrierRow,
        carrierDocs,
        subjects,
        on: today(),
    });
}

export type GateFlagPatch = {
    flaggedForReview: true
    flagReason: string
    flaggedAt: Date
    flaggedBy: string
};

/**
 * Applies the gate to a booking attempt.
 *
 * Raises whatever the mode says is disqualifying, and returns the flag
 * columns to fold into the order's own update — the flag is written in the
 * same statement as the booking it describes, so an order can never be
 * committed without the reason it was questionable.
 *
 * In `warn` mode nothing is refused, but the flag is still produced: the
 * point of the flag is that the backlog stays visible while enforcement is
 * being phased in.
 */
export async function guardOrderGate(
    db: Db,
    parties: OrderParties,
    actor: Actor,
    opts?: { note?: string | null },
): Promise<{ gate: OrderGate; flagPatch: GateFlagPatch | null }> {
    const gate = await loadOrderGate(db, parties);

    if (gate.blocked && !gate.carrier.eligible) {
        // The specific code says *why* — missing contract reads very
        // differently to unverified paperwork
        throw new TRPCError({ code: "FORBIDDEN", message: gate.carrier.code });
    }

    if (gate.mode === "block") {
        // Accepting a known risk is a supervisory act, and it has to be
        // explained — an unattributed acceptance is not a control
        if (gate.requirements.includes("manager")) {
            // A partner has no supervisory role to accept it with, and
            // never acknowledges a risk on its own behalf: the booking
            // waits for Appload to look at it
            if (actor.kind === "tenant") {
                throw new TRPCError({ code: "FORBIDDEN", message: "RISK_REVIEW_REQUIRED" });
            }
            if (!isAuthorized(actor.role, "risk", ["flag"])) {
                throw new TRPCError({ code: "FORBIDDEN", message: "RISK_ACK_NOT_ALLOWED" });
            }
        }
        if (gate.requirements.includes("note") && !opts?.note?.trim()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "RISK_ACK_NOTE_REQUIRED" });
        }
    }

    if (!gate.requirements.includes("flag")) {
        return { gate, flagPatch: null };
    }

    const reason = gateFlagReason(gate);

    return {
        gate,
        flagPatch: reason
            ? {
                flaggedForReview: true,
                flagReason: opts?.note?.trim() ? `${reason} — ${opts.note.trim()}` : reason,
                flaggedAt: new Date(),
                flaggedBy: actor.userId,
            }
            : null,
    };
}

/**
 * The driver and the vehicles named on the order, with their KYC state and
 * what they hold of the papers dispatch asks for. Labelled the way the flag
 * reason will show them: the driver by name, vehicles by plate.
 *
 * The rows themselves come from the dispatch lookup, so the gate that flags
 * an unreviewed rig and the guard that refuses one without papers are
 * reading the same document set.
 */
async function loadPartySubjects(db: Db, parties: OrderParties): Promise<SubjectFlag[]> {
    const subjects = await loadRigSubjects(db, parties);

    return subjects.map((subject) => ({
        kind: subject.kind,
        label: subject.label,
        kycStatus: subject.kycStatus,
        ...(subject.ownershipStatus && { ownershipStatus: subject.ownershipStatus }),
        papers: paperState(subject),
    }));
}
