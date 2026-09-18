import "server-only";

import { and, eq, or } from "drizzle-orm";

import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { order, orderDispatch, orderDispatchDocument } from "@workspace/db/orders";
import { KYC_SUBJECT_TYPE, type KycSubjectType } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

/**
 * Who, in the portal, may see a verification document.
 *
 * Admin answers this with one question (is the caller staff); a partner
 * cannot, because the KYC store holds every company's papers in one table.
 * Two rules decide it here: a company reaches its own drivers and vehicles,
 * and either party on an order reaches the papers that order was dispatched
 * with — the snapshot, not the live set, so a shipper never gains a standing
 * window into a carrier's fleet.
 */

type Db = typeof Database;

const SUBJECT_TABLE = { driver, truck, trailer, link } as const;

/**
 * Guards a subject type that arrives as a bare string — the EdgeStore hook
 * hands the owner lookup a path segment, not a typed value.
 */
export const isKycSubjectType = (value: string): value is KycSubjectType =>
    (KYC_SUBJECT_TYPE as readonly string[]).includes(value);

/**
 * The organization a KYC subject belongs to: the carrier a driver or vehicle
 * is registered to, or — for an organization subject — itself.
 *
 * Also what the EdgeStore hosts hand the kycFiles bucket, so the path a file
 * is written to and the row it is later attached to answer to one lookup.
 */
export async function kycSubjectOwner(
    db: Db,
    subjectType: KycSubjectType,
    subjectId: string,
): Promise<string | null> {
    if (subjectType === "organization") return subjectId;

    const table = SUBJECT_TABLE[subjectType];

    const [row] = await db
        .select({ carrierId: table.carrierId })
        .from(table)
        .where(eq(table.id, subjectId))
        .limit(1);

    return row?.carrierId ?? null;
}

/**
 * Whether this subject is the tenant's own.
 *
 * The one statement of portal KYC ownership. The portal's kyc router states
 * the same rule inline (`ownedSubject` scopes the row it already loads by
 * `carrierId`); change one and the other has to follow.
 */
export async function tenantOwnsSubject(
    db: Db,
    tenantId: string,
    subjectType: KycSubjectType,
    subjectId: string,
): Promise<boolean> {
    return (await kycSubjectOwner(db, subjectType, subjectId)) === tenantId;
}

/**
 * Whether the tenant may read the pages of one document: its own subject's,
 * or one that travelled in the dispatch pack of an order it is a party to.
 *
 * The second rule is what lets a shipper open the licence of the driver who
 * is coming to its loading site, and the carrier re-read what it submitted,
 * without either of them being able to ask for anything else. It is a lookup
 * on the document id (order_dispatch_document_kyc_idx), so a paper that was
 * never dispatched is not reachable by any order.
 *
 * It is also tied to the carrier the order is run by *now*. An order can walk
 * back to `prospect` and be re-accepted by a different carrier, and the packs
 * of the previous one stay on the order; without that condition the incoming
 * carrier would inherit a window into another company's ID scans.
 */
export async function tenantCanReadKycDocument(
    db: Db,
    tenantId: string,
    doc: { id: string; subjectType: KycSubjectType; subjectId: string },
): Promise<boolean> {
    const owner = await kycSubjectOwner(db, doc.subjectType, doc.subjectId);

    if (owner === tenantId) return true;
    if (owner === null) return false;

    const [dispatched] = await db
        .select({ dispatchId: orderDispatchDocument.dispatchId })
        .from(orderDispatchDocument)
        .innerJoin(orderDispatch, eq(orderDispatch.id, orderDispatchDocument.dispatchId))
        .innerJoin(order, eq(order.id, orderDispatch.orderId))
        .where(and(
            eq(orderDispatchDocument.kycDocumentId, doc.id),
            // The paper has to belong to the carrier this order is run by
            eq(order.carrierId, owner),
            or(eq(order.shipperId, tenantId), eq(order.carrierId, tenantId)),
        ))
        .limit(1);

    return dispatched !== undefined;
}
