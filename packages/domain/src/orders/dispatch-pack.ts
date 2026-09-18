import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { orderDispatch, orderDispatchDocument, type CreateOrderDispatchDocument, type Order } from "@workspace/db/orders";
import { kycDocument } from "@workspace/db/kyc-documents";
import type { KycDocumentStatus, KycDocumentType, KycPage, OrderDispatchSubject } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { withProxiedPages } from "@workspace/domain/kyc/file-access";
import { loadRigSubjects, type DispatchRig } from "@workspace/domain/orders/dispatch-papers";
import { dispatchDocsFor } from "@workspace/domain/orders/dispatch-readiness";

/**
 * The dispatch pack: who and what left for the loading site, and which
 * papers were on file for them at that moment.
 *
 * The pack is the fact the loading check is run against — the truck and the
 * driver who turn up are compared to what was submitted, not to a fleet
 * registry that may have changed since — and the only window a shipper gets
 * into a carrier's verification store (see kyc/tenant-access).
 *
 * One pack is open per order (`superseded_at is null`); a re-dispatch or an
 * admin correcting the rig writes a new one and closes the old.
 */

type Db = typeof Database;

/** One snapshotted paper, as the loading-check card renders it. */
export type DispatchPackDocument = {
    /** The kyc_document id; the page hrefs below are proxied against it */
    id: string;
    type: KycDocumentType;
    /** What the paper's status was when the truck was dispatched */
    statusAtSnapshot: KycDocumentStatus;
    /** What it is now — a pack paper can be reviewed after the fact */
    status: KycDocumentStatus;
    expiresAt: string | null;
    /** Session-gated hrefs; the storage URLs never leave the server */
    pages: KycPage[];
};

/**
 * One subject of the pack. `subjectId` is null for a plate that was typed
 * onto the order without a fleet row behind it — it has a label and no
 * papers, which is exactly what the card should show.
 */
export type DispatchPackSubject = {
    kind: OrderDispatchSubject;
    subjectId: string | null;
    /** The driver's name or the plate, as the pack recorded it */
    label: string;
    documents: DispatchPackDocument[];
};

export type DispatchPack = {
    id: string;
    dispatchedAt: Date;
    /** Null when a backfill wrote the pack rather than a person */
    dispatchedBy: string | null;
    subjects: DispatchPackSubject[];
};

/** The order columns a pack is written from. */
type DispatchSource = DispatchRig & Pick<Order, "driverName" | "driverPhoneNumber" | "driverPassport">;

/**
 * Writes the pack for a dispatch, closing whatever pack was open.
 *
 * `actor` is the person who did it — on the supersede it records who
 * replaced the old pack, not what replaced it; the successor is simply the
 * open pack of the same order.
 *
 * Returns the new pack's id, which the transition carries into its history
 * row so the timeline can point at the papers the truck left with.
 */
export async function recordDispatch(
    db: Db,
    params: { orderPk: string; row: DispatchSource; actor: string | null },
): Promise<string> {
    const { row } = params;
    const subjects = await loadRigSubjects(db, row);
    const byKind = new Map(subjects.map((subject) => [subject.kind, subject]));

    await db
        .update(orderDispatch)
        .set({ supersededAt: new Date(), supersededBy: params.actor })
        .where(and(eq(orderDispatch.orderId, params.orderPk), isNull(orderDispatch.supersededAt)));

    const [pack] = await db
        .insert(orderDispatch)
        .values({
            orderId: params.orderPk,
            driverId: row.driverId ?? null,
            driverName: row.driverName,
            driverPhoneNumber: row.driverPhoneNumber,
            driverPassport: row.driverPassport,
            // The plates are what the order carries; the ids are the fleet
            // rows they resolved to, and stay null for a plate nobody has
            // registered
            truckId: byKind.get("truck")?.subjectId ?? null,
            trailerId: byKind.get("trailer")?.subjectId ?? null,
            linkId: byKind.get("link")?.subjectId ?? null,
            truckPlate: row.truckPlate ?? null,
            trailerPlate: row.trailerPlate ?? null,
            linkPlate: row.linkPlate ?? null,
            dispatchedBy: params.actor,
        })
        .returning({ id: orderDispatch.id });

    if (!pack) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DISPATCH_NOT_RECORDED" });
    }

    // Only the papers dispatch asks for (D4). The pack is what opens a
    // carrier's store to the shipper — `tenantCanReadKycDocument` grants a
    // party of the order every document the pack names — so a type that is
    // not part of the loading check has no business in it: a vehicle's
    // proof-of-ownership says who the truck really belongs to, and that
    // stays a reviewer's concern.
    const documents: CreateOrderDispatchDocument[] = subjects.flatMap((subject) =>
        subject.docs.filter((doc) => dispatchDocsFor(subject.kind).includes(doc.type)).map((doc) => ({
            dispatchId: pack.id,
            subjectType: subject.kind,
            subjectId: subject.subjectId,
            kycDocumentId: doc.id,
            type: doc.type,
            statusAtSnapshot: doc.status,
            expiresAt: doc.expiresAt,
        })),
    );

    if (documents.length > 0) {
        await db.insert(orderDispatchDocument).values(documents);
    }

    return pack.id;
}

/**
 * The pack currently in force on an order, with its papers, or null when the
 * order was dispatched before packs existed (or the write that should have
 * made one failed — there are no transactions here, and every reader has to
 * tolerate it).
 *
 * Soft-deleted documents are skipped: `tenantCanReadKycDocument` does not
 * filter them, so a paper withdrawn after the dispatch must not reappear
 * here as a readable page.
 */
export async function loadDispatchPack(db: Db, orderPk: string): Promise<DispatchPack | null> {
    const [pack] = await db
        .select()
        .from(orderDispatch)
        .where(and(eq(orderDispatch.orderId, orderPk), isNull(orderDispatch.supersededAt)))
        .limit(1);

    if (!pack) return null;

    const rows = await db
        .select({
            subjectType: orderDispatchDocument.subjectType,
            subjectId: orderDispatchDocument.subjectId,
            statusAtSnapshot: orderDispatchDocument.statusAtSnapshot,
            id: kycDocument.id,
            type: kycDocument.type,
            status: kycDocument.status,
            expiresAt: kycDocument.expiresAt,
            pages: kycDocument.pages,
        })
        .from(orderDispatchDocument)
        .innerJoin(kycDocument, eq(kycDocument.id, orderDispatchDocument.kycDocumentId))
        .where(and(
            eq(orderDispatchDocument.dispatchId, pack.id),
            isNull(kycDocument.deletedAt),
        ))
        .orderBy(orderDispatchDocument.subjectType, kycDocument.type);

    const entries: { kind: OrderDispatchSubject; subjectId: string | null; label: string | null }[] = [
        { kind: "driver", subjectId: pack.driverId, label: pack.driverName },
        { kind: "truck", subjectId: pack.truckId, label: pack.truckPlate },
        { kind: "trailer", subjectId: pack.trailerId, label: pack.trailerPlate },
        { kind: "link", subjectId: pack.linkId, label: pack.linkPlate },
    ];

    const subjects: DispatchPackSubject[] = entries
        // A rig has no trailer or link half the time; a driver always has a
        // name, so an entry with neither is simply not part of this pack
        .filter((entry) => entry.subjectId !== null || entry.label !== null)
        .map((entry) => ({
            kind: entry.kind,
            subjectId: entry.subjectId,
            label: entry.label ?? "",
            documents: rows
                .filter((row) => row.subjectType === entry.kind)
                .map((row) => {
                    // Storage URLs stop here, as everywhere else the pages
                    // leave the server
                    const { pages } = withProxiedPages({ id: row.id, pages: row.pages });

                    return {
                        id: row.id,
                        type: row.type,
                        statusAtSnapshot: row.statusAtSnapshot,
                        status: row.status,
                        expiresAt: row.expiresAt,
                        pages,
                    };
                }),
        }));

    return {
        id: pack.id,
        dispatchedAt: pack.dispatchedAt,
        dispatchedBy: pack.dispatchedBy,
        subjects,
    };
}

/** The order columns that decide whether the rig on file has changed. */
type RigColumns = Pick<Order, "driverId" | "truckPlate" | "trailerPlate" | "linkPlate">;

const RIG_COLUMNS = ["driverId", "truckPlate", "trailerPlate", "linkPlate"] as const;

/**
 * Whether a patch repoints the rig. An empty string clears a column the same
 * way null does — the update writes `|| null` — so the two compare equal
 * here, and a patch that merely re-sends what is stored is not a change.
 */
export function rigChanged(patch: Partial<RigColumns>, current: RigColumns): boolean {
    return RIG_COLUMNS.some((column) =>
        patch[column] !== undefined && (patch[column] || null) !== (current[column] || null));
}
