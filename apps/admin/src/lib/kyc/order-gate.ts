import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";

import { organization } from "@workspace/db/users";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import type { db as Database } from "@workspace/db/db";
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions";

import { today } from "@/lib/kyc/derive";
import { currentDocuments, loadSubject, toCurrentDoc } from "@/lib/kyc/subjects";
import {
    enforcementMode,
    evaluateOrderGate,
    gateFlagReason,
    type OrderGate,
    type SubjectFlag,
} from "@/lib/kyc/enforcement";

type Db = typeof Database;

export type OrderParties = {
    carrierId: string
    driverId?: string | null
    truckPlate?: string | null
    trailerPlate?: string | null
    linkPlate?: string | null
};

const VEHICLE_TABLE = { truck, trailer, link } as const;

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
    actor: { role: StaffRole; actorId: string; note?: string | null },
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
        if (gate.requirements.includes("manager") && !isAuthorized(actor.role, "risk", ["flag"])) {
            throw new TRPCError({ code: "FORBIDDEN", message: "RISK_ACK_NOT_ALLOWED" });
        }
        if (gate.requirements.includes("note") && !actor.note?.trim()) {
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
                flagReason: actor.note?.trim() ? `${reason} — ${actor.note.trim()}` : reason,
                flaggedAt: new Date(),
                flaggedBy: actor.actorId,
            }
            : null,
    };
}

/** The driver and the vehicles named on the order, with their KYC state. */
async function loadPartySubjects(db: Db, parties: OrderParties): Promise<SubjectFlag[]> {
    const plateLookups = (["truck", "trailer", "link"] as const)
        .map((kind) => ({ kind, plate: parties[`${kind}Plate` as const] }))
        .filter((entry): entry is { kind: "truck" | "trailer" | "link"; plate: string } =>
            typeof entry.plate === "string" && entry.plate.length > 0,
        );

    const [driverRows, ...vehicleRows] = await Promise.all([
        parties.driverId
            ? db.select({ id: driver.id, kycStatus: driver.kycStatus })
                .from(driver)
                .where(eq(driver.id, parties.driverId))
            : Promise.resolve([]),

        ...plateLookups.map(({ kind, plate }) => {
            const table = VEHICLE_TABLE[kind];

            return db
                .select({
                    regPlate: table.regPlate,
                    kycStatus: table.kycStatus,
                    ownershipStatus: table.ownershipStatus,
                })
                .from(table)
                .where(inArray(table.regPlate, [plate]));
        }),
    ]);

    const subjects: SubjectFlag[] = [];

    for (const row of driverRows) {
        subjects.push({ kind: "driver", label: row.id, kycStatus: row.kycStatus });
    }

    plateLookups.forEach(({ kind }, index) => {
        for (const row of vehicleRows[index] ?? []) {
            subjects.push({
                kind,
                label: row.regPlate,
                kycStatus: row.kycStatus,
                ownershipStatus: row.ownershipStatus,
            });
        }
    });

    return subjects;
}
