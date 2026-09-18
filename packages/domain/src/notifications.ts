import "server-only";

import { eq } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { member } from "@workspace/db/users";
import { notification, type NotificationKind, type NotificationParams } from "@workspace/db/notifications";

/**
 * One event to write into the portal's notification centre. Recipients are
 * either named explicitly (`userIds` — the claimant, the one member who
 * asked) or resolved to every member of `organizationId`, which is the
 * normal case: the event concerns the company, so everyone who works there
 * sees it and each of them carries their own read state.
 *
 * `email` moves the row into the outbox (`emailState` "pending") for the
 * sweep to pick up; `dedupeKey` makes a re-run of a materializer harmless.
 */
export type NotifyInput = {
    organizationId: string;
    kind: NotificationKind;
    /** What to link to, e.g. "order" + order id */
    entityType?: string;
    entityId?: string;
    /** Display values the message is rendered from — scalars only */
    params?: NotificationParams;
    /** Queue an email alongside the in-app row */
    email?: boolean;
    /** Idempotency key for rows derived from another table */
    dedupeKey?: string;
    /** Recipients; every member of the organization when omitted */
    userIds?: string[];
};

/**
 * Fans one event out to its recipients, one row each. Returns how many rows
 * were actually written: the partial unique index on (user, dedupeKey) makes
 * a repeated materialization insert nothing, and an organization with no
 * members yet (nobody has joined the portal) writes nothing at all.
 *
 * A pure database write — no email is sent here, no cache is touched.
 */
export async function notify(db: typeof Database, input: NotifyInput): Promise<number> {
    const recipients = input.userIds ?? (await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, input.organizationId))).map((row) => row.userId);

    if (recipients.length === 0) return 0;

    const rows = await db
        .insert(notification)
        .values(recipients.map((userId) => ({
            organizationId: input.organizationId,
            userId,
            kind: input.kind,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            params: input.params ?? {},
            emailState: input.email ? ("pending" as const) : ("none" as const),
            dedupeKey: input.dedupeKey ?? null,
        })))
        // Covers the (user, dedupeKey) index: the same source event can be
        // replayed without doubling anyone's inbox
        .onConflictDoNothing()
        .returning({ id: notification.id });

    return rows.length;
}
