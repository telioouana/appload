import "server-only";

/**
 * The reads that follow a load across companies.
 *
 * A subcontract chain is a linked list in one table: A's order points at B's
 * row, B's may point at C's, and the last row — driver phone set, nothing
 * linked below it — is the one with the truck. Every walk here is capped,
 * because a chain is data that other companies write, and a loop that should
 * be impossible is still no reason to spin a request forever.
 */

import { and, eq, isNotNull, or } from "drizzle-orm";

import { partnerConnection } from "@workspace/db/connections";
import type { db as Database } from "@workspace/db/db";
import { movement, type Movement } from "@workspace/db/movements";
import { isApploadOrg } from "@workspace/db/types";
import { organization } from "@workspace/db/users";

type Db = typeof Database;

/**
 * How far a walk goes. A chain of five companies each handing the same load
 * down is already implausible; the cap exists for the case that should never
 * happen, and it says so when it does.
 */
export const MAX_HOPS = 5;

/** The row with the truck: follows the links down until one ends. */
export async function terminalMovementId(db: Db, id: string): Promise<string> {
    let current = id;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
        const [row] = await db
            .select({ next: movement.executionMovementId })
            .from(movement)
            .where(eq(movement.id, current))
            .limit(1);

        if (!row?.next) return current;
        current = row.next;
    }

    console.warn(`movement chain from ${id} is longer than ${MAX_HOPS} hops; stopping at ${current}`);
    return current;
}

/** The row this one is the executor's copy of, when it is one. */
export async function parentMovement(db: Db, id: string): Promise<Movement | null> {
    const [row] = await db
        .select()
        .from(movement)
        .where(eq(movement.executionMovementId, id))
        .limit(1);

    return row ?? null;
}

/**
 * Whether two companies have an accepted connection, in either direction.
 * Checked on every write that names another company: an id typed into a
 * request is never trusted, and a connection that ended closes the door.
 */
export async function isConnected(db: Db, a: string, b: string): Promise<boolean> {
    // Appload is connected to everyone by construction: it is the brokerage
    // every tenant already has an account with, not a partner one invites
    if (isApploadOrg(a) || isApploadOrg(b)) return true;

    const [row] = await db
        .select({ id: partnerConnection.id })
        .from(partnerConnection)
        .where(and(
            eq(partnerConnection.status, "accepted"),
            or(
                and(eq(partnerConnection.requesterOrgId, a), eq(partnerConnection.targetOrgId, b)),
                and(eq(partnerConnection.targetOrgId, a), eq(partnerConnection.requesterOrgId, b)),
            ),
        ))
        .limit(1);

    return Boolean(row);
}

/**
 * Whether the executor can answer for itself: somebody from that company has
 * activated the portal. A partner registered by its client as a shell record
 * has nobody to click accept, so it is tracked the way an off-platform
 * carrier always was — by the owner, on the driver's phone. Read live, since
 * a shell company that later claims its record becomes a portal tenant in
 * the middle of somebody's open loads.
 */
export async function isOnPortal(db: Db, organizationId: string | null): Promise<boolean> {
    if (!organizationId) return false;

    // Appload answers for itself in Admin, which is the same guarantee this
    // predicate exists to make: somebody is there to read the offer
    if (isApploadOrg(organizationId)) return true;

    const [row] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.id, organizationId), isNotNull(organization.portalActivatedAt)))
        .limit(1);

    return Boolean(row);
}

/** The company names a notification is written in. */
export async function organizationName(db: Db, organizationId: string): Promise<string> {
    const [row] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

    return row?.name ?? "";
}
