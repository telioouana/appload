import { and, eq, gt, isNull, or } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { memberPermission } from "@workspace/db/permissions";

import { effectiveAccess, profileOf, type EffectiveAccess, type PermissionChange } from "@workspace/auth/organization-permissions";

/**
 * One member's changes that can still count — not revoked and not lapsed.
 * A change not yet started is read too, and left out by the resolver until
 * its window opens.
 */
export async function openChanges(db: typeof Database, memberId: string, now: Date = new Date()): Promise<PermissionChange[]> {
    return db
        .select({
            kind: memberPermission.kind,
            permission: memberPermission.permission,
            startsAt: memberPermission.startsAt,
            endsAt: memberPermission.endsAt,
            revokedAt: memberPermission.revokedAt,
            createdAt: memberPermission.createdAt,
        })
        .from(memberPermission)
        .where(and(
            eq(memberPermission.memberId, memberId),
            isNull(memberPermission.revokedAt),
            or(isNull(memberPermission.endsAt), gt(memberPermission.endsAt, now)),
        ));
}

/** What one member may do right now: their profile with their live changes applied. */
export async function memberAccess(
    db: typeof Database,
    member: { id: string; role: string | null },
    now: Date = new Date(),
): Promise<EffectiveAccess> {
    return effectiveAccess(profileOf(member.role), await openChanges(db, member.id, now), now);
}
