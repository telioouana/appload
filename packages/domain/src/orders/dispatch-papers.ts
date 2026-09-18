import "server-only";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { driver } from "@workspace/db/fleet";
import { kycDocument } from "@workspace/db/kyc-documents";
import { user } from "@workspace/db/users";
import type { KycDocumentStatus, KycDocumentType, KycStatus, OrderDispatchSubject, OwnershipStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { pickCurrent, VEHICLE_TABLE } from "@workspace/domain/kyc/subjects";
import {
    missingForDispatch,
    missingPapers,
    unreviewedPapers,
    type DispatchReadiness,
    type DispatchRow,
    type PaperSubject,
} from "@workspace/domain/orders/dispatch-readiness";

/**
 * The rig of an order, read off the order's own columns.
 *
 * The driver is an id (an account in the carrier's registry), the vehicles
 * are plates: that is how the order row stores them, and how a plate typed
 * by ops finds the fleet row behind it.
 */
export type DispatchRig = {
    driverId?: string | null;
    truckPlate?: string | null;
    trailerPlate?: string | null;
    linkPlate?: string | null;
};

type Db = typeof Database;

/** One paper of a rig subject, with what the dispatch pack has to snapshot. */
export type RigPaper = {
    id: string;
    type: KycDocumentType;
    status: KycDocumentStatus;
    expiresAt: string | null;
};

/**
 * A subject of the rig with its verification state and its live document
 * set. A superset of `PaperSubject`, so the pure readiness rules read it
 * directly, and of what the order gate needs to flag it.
 */
export type RigSubject = {
    kind: OrderDispatchSubject;
    subjectId: string;
    label: string;
    kycStatus: KycStatus;
    ownershipStatus?: OwnershipStatus;
    docs: RigPaper[];
};

/**
 * The driver and the vehicles named on an order, with their verification
 * state and whatever is on file for each.
 *
 * The one lookup behind three readers: the order gate (which turns it into
 * flags), the dispatch guard (which refuses a truck whose papers are not in)
 * and the dispatch pack (which snapshots it). They must never disagree about
 * what the rig holds, so they all read it through here — each with its own
 * call, which is why the papers of every subject are read in one query.
 *
 * Labelled the way the flag reason and the dialogs show it: the driver by
 * name, vehicles by plate.
 */
export async function loadRigSubjects(db: Db, rig: DispatchRig): Promise<RigSubject[]> {
    const plateLookups = (["truck", "trailer", "link"] as const)
        .map((kind) => ({ kind, plate: rig[`${kind}Plate` as const] }))
        .filter((entry): entry is { kind: "truck" | "trailer" | "link"; plate: string } =>
            typeof entry.plate === "string" && entry.plate.length > 0,
        );

    const [driverRows, ...vehicleRows] = await Promise.all([
        rig.driverId
            ? db.select({ id: driver.id, name: user.name, kycStatus: driver.kycStatus })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .where(eq(driver.id, rig.driverId))
            : Promise.resolve([]),

        ...plateLookups.map(({ kind, plate }) => {
            const table = VEHICLE_TABLE[kind];

            return db
                .select({
                    id: table.id,
                    regPlate: table.regPlate,
                    kycStatus: table.kycStatus,
                    ownershipStatus: table.ownershipStatus,
                })
                .from(table)
                .where(inArray(table.regPlate, [plate]));
        }),
    ]);

    const found: Omit<RigSubject, "docs">[] = [];

    for (const row of driverRows) {
        found.push({ kind: "driver", subjectId: row.id, label: row.name, kycStatus: row.kycStatus });
    }

    plateLookups.forEach(({ kind }, index) => {
        for (const row of vehicleRows[index] ?? []) {
            found.push({
                kind,
                subjectId: row.id,
                label: row.regPlate,
                kycStatus: row.kycStatus,
                ownershipStatus: row.ownershipStatus,
            });
        }
    });

    if (found.length === 0) return [];

    // Every subject's papers in one read. The order gate runs this on each
    // render of an order, so a query per subject would be four round trips
    // for a rig nobody is looking at; `pickCurrent` applies the same live-set
    // rule `currentDocuments` does, per subject.
    const docRows = await db
        .select()
        .from(kycDocument)
        .where(and(
            isNull(kycDocument.deletedAt),
            or(...found.map((subject) => and(
                eq(kycDocument.subjectType, subject.kind),
                eq(kycDocument.subjectId, subject.subjectId),
            ))),
        ))
        .orderBy(desc(kycDocument.createdAt));

    return found.map((subject) => ({
        ...subject,
        docs: pickCurrent(docRows.filter((row) =>
            row.subjectType === subject.kind && row.subjectId === subject.subjectId,
        )).map((doc) => ({
            id: doc.id,
            type: doc.type,
            status: doc.status,
            expiresAt: doc.expiresAt,
        })),
    }));
}

/**
 * Everything the dispatch move is judged on, for one stored order row: the
 * fields it still lacks and the papers its rig still owes.
 *
 * Both the guard inside the transition and the options the dialogs are built
 * from call this, so a move is never advertised as takeable when the
 * mutation would refuse it.
 */
export async function loadDispatchReadiness(
    db: Db,
    row: DispatchRow & DispatchRig,
): Promise<DispatchReadiness> {
    const subjects: PaperSubject[] = await loadRigSubjects(db, row);

    return {
        fields: missingForDispatch(row),
        papers: missingPapers(subjects),
        unreviewed: unreviewedPapers(subjects),
    };
}
