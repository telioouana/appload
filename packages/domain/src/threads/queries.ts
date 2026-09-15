import "server-only";

import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";

import type { db as Database } from "@workspace/db/db";
import { order } from "@workspace/db/orders";
import {
    thread,
    threadMessage,
    threadParticipant,
    threadRead,
    type ThreadAttachment,
} from "@workspace/db/threads";
import type { ThreadSubject } from "@workspace/db/types";
import { organization, user } from "@workspace/db/users";

import type { Actor } from "@workspace/domain/orders/actor";
import {
    resolveThreadSubject,
    threadAccess,
    type ThreadSides,
    type ThreadSubjectRef,
} from "@workspace/domain/threads/access";

/** One page of history. A shipment's conversation is short; this is generous. */
const DEFAULT_MESSAGE_LIMIT = 50;

/**
 * The thread of one shipment, created on first sight.
 *
 * The row is an upsert on `(subject_type, subject_id)` so two readers opening
 * the same order at once end up in the same conversation, and the participant
 * rows are made to match the subject's sides every time: a carrier booked
 * after the shipper already opened the thread joins it here, and one that
 * lost the job leaves — the cache converges on the authority, without a
 * migration of any kind.
 */
export async function ensureThread(
    db: typeof Database,
    subject: ThreadSubjectRef,
    sides: ThreadSides,
): Promise<string> {
    const [row] = await db
        .insert(thread)
        .values({ subjectType: subject.subjectType, subjectId: subject.subjectId })
        // A no-op write, for its RETURNING: the id of the row that is there
        // now, whether this call is what put it there or another one did
        .onConflictDoUpdate({
            target: [thread.subjectType, thread.subjectId],
            set: { subjectType: subject.subjectType },
        })
        .returning({ id: thread.id });

    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "THREAD_NOT_CREATED" });

    const participants = [
        ...sides.orgIds.map((organizationId) => ({ threadId: row.id, organizationId, staff: false })),
        ...(sides.staff ? [{ threadId: row.id, organizationId: null, staff: true }] : []),
    ];

    if (participants.length > 0) {
        // Covers both partial uniques (one row per organization, one staff
        // row): re-asserting a side that is already there writes nothing
        await db.insert(threadParticipant).values(participants).onConflictDoNothing();
    }

    // Sides are lost as well as gained — a booking undone drops the carrier —
    // and the unread badge is counted off these rows. A company left behind
    // here would keep counting messages on a shipment it can no longer open,
    // with no way to clear the count. An organization deleted since is nobody
    // and goes with them. Every subject has an organization side, so the list
    // is never empty.
    await db.delete(threadParticipant).where(and(
        eq(threadParticipant.threadId, row.id),
        eq(threadParticipant.staff, false),
        or(
            isNull(threadParticipant.organizationId),
            notInArray(threadParticipant.organizationId, sides.orgIds),
        ),
    ));

    return row.id;
}

export type ThreadParticipantView = {
    /** Null on the Appload side, which `staff` is what identifies */
    organizationId: string | null;
    staff: boolean;
    /** Null for staff, and for an organization deleted since */
    name: string | null;
};

export type ThreadView = {
    threadId: string;
    subject: ThreadSubjectRef;
    /** The order id, or the load's reference */
    label: string;
    participants: ThreadParticipantView[];
    /** Messages this reader has not seen yet */
    unread: number;
    lastReadAt: Date | null;
};

/**
 * The thread behind a subject, for a caller entitled to it.
 *
 * Refuses with NOT_FOUND rather than FORBIDDEN: to somebody who is not a
 * party, a shipment they were not told about and one that does not exist must
 * read the same.
 */
export async function getThread(
    db: typeof Database,
    actor: Actor,
    subject: ThreadSubjectRef,
): Promise<ThreadView> {
    const resolved = await resolveThreadSubject(db, subject);

    if (!resolved || !threadAccess(actor, resolved.sides)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "THREAD_NOT_FOUND" });
    }

    const threadId = await ensureThread(db, resolved.subject, resolved.sides);

    const [participants, [read]] = await Promise.all([
        db
            .select({
                organizationId: threadParticipant.organizationId,
                staff: threadParticipant.staff,
                name: organization.name,
            })
            .from(threadParticipant)
            .leftJoin(organization, eq(organization.id, threadParticipant.organizationId))
            .where(eq(threadParticipant.threadId, threadId)),
        db
            .select({ lastReadAt: threadRead.lastReadAt })
            .from(threadRead)
            .where(and(eq(threadRead.threadId, threadId), eq(threadRead.userId, actor.userId)))
            .limit(1),
    ]);

    const [unread] = await db
        .select({ value: count() })
        .from(threadMessage)
        .where(and(
            eq(threadMessage.threadId, threadId),
            notSentBy(actor.userId),
            read ? gt(threadMessage.createdAt, read.lastReadAt) : undefined,
        ));

    return {
        threadId,
        subject: resolved.subject,
        label: resolved.label,
        participants,
        unread: unread?.value ?? 0,
        lastReadAt: read?.lastReadAt ?? null,
    };
}

/**
 * The id of an existing thread, for a caller entitled to it — null when
 * nobody has written into this shipment yet.
 *
 * What the polling reads go through: a conversation window asks for messages
 * every few seconds, and re-asserting the thread and its participants on each
 * of those would be three writes a tick. Opening the thread (`getThread`) is
 * what creates it.
 */
export async function findThread(
    db: typeof Database,
    actor: Actor,
    subject: ThreadSubjectRef,
): Promise<string | null> {
    const resolved = await resolveThreadSubject(db, subject);

    if (!resolved || !threadAccess(actor, resolved.sides)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "THREAD_NOT_FOUND" });
    }

    const [row] = await db
        .select({ id: thread.id })
        .from(thread)
        .where(and(
            eq(thread.subjectType, resolved.subject.subjectType),
            eq(thread.subjectId, resolved.subject.subjectId),
        ))
        .limit(1);

    return row?.id ?? null;
}

export type ThreadMessageView = {
    id: string;
    body: string;
    attachments: ThreadAttachment[];
    senderUserId: string | null;
    /** Null = sent from the Appload side */
    senderOrgId: string | null;
    /** Null when the sender's account is gone */
    senderName: string | null;
    createdAt: Date;
};

/**
 * One page of a thread, newest first — the order a chat window renders in,
 * and the order `before` pages backwards through. Both are served by the
 * `(thread_id, created_at)` index.
 *
 * Access is the caller's to check: this is reached through `getThread` or
 * `sendMessage`, which both resolve the subject first.
 */
export async function listMessages(
    db: typeof Database,
    threadId: string,
    options: { before?: Date; limit?: number } = {},
): Promise<ThreadMessageView[]> {
    return db
        .select({
            id: threadMessage.id,
            body: threadMessage.body,
            attachments: threadMessage.attachments,
            senderUserId: threadMessage.senderUserId,
            senderOrgId: threadMessage.senderOrgId,
            senderName: user.name,
            createdAt: threadMessage.createdAt,
        })
        .from(threadMessage)
        .leftJoin(user, eq(user.id, threadMessage.senderUserId))
        .where(and(
            eq(threadMessage.threadId, threadId),
            options.before ? lt(threadMessage.createdAt, options.before) : undefined,
        ))
        .orderBy(desc(threadMessage.createdAt))
        .limit(options.limit ?? DEFAULT_MESSAGE_LIMIT);
}

export type ThreadUnread = {
    total: number;
    byThread: { threadId: string; subjectType: ThreadSubject; subjectId: string; count: number }[];
};

/**
 * What this reader has waiting, across every thread their side is in.
 *
 * One query for the whole badge: the participant row is the entry point
 * (`thread_participant_org_idx` for a partner, the partial staff unique for
 * ops), and each message is compared against this reader's own cursor —
 * unread is per person, not per company.
 */
export async function unreadForUser(db: typeof Database, actor: Actor): Promise<ThreadUnread> {
    const rows = await unreadRows(db, actor.userId, mySide(actor));

    return {
        total: rows.reduce((sum, row) => sum + row.count, 0),
        byThread: rows,
    };
}

/** The counting itself, shared by the badge and the admin's thread list. */
function unreadRows(db: typeof Database, userId: string, side: SQL | undefined) {
    return db
        .select({
            threadId: thread.id,
            subjectType: thread.subjectType,
            subjectId: thread.subjectId,
            count: count(threadMessage.id),
        })
        .from(threadParticipant)
        .innerJoin(thread, eq(thread.id, threadParticipant.threadId))
        .innerJoin(threadMessage, eq(threadMessage.threadId, thread.id))
        .leftJoin(threadRead, and(
            eq(threadRead.threadId, thread.id),
            eq(threadRead.userId, userId),
        ))
        .where(and(
            side,
            notSentBy(userId),
            or(isNull(threadRead.lastReadAt), gt(threadMessage.createdAt, threadRead.lastReadAt)),
        ))
        .groupBy(thread.id, thread.subjectType, thread.subjectId);
}

export type StaffThreadRow = {
    threadId: string;
    /** The order the thread hangs off — staff threads are order threads */
    orderId: string;
    shipperName: string | null;
    carrierName: string | null;
    lastMessage: string | null;
    lastMessageAt: Date | null;
    unread: number;
};

/**
 * The order conversations, for the admin's Messages page. Newest first, the
 * way the driver conversations beside them are listed.
 *
 * The staff participant row is the filter: a portal load's thread has no
 * staff side, so it can never appear here — and `subject_id` is the human
 * order id, which is what the page's order panel already takes.
 *
 * A thread nobody has written into yet is not a conversation: opening an
 * order creates its thread, and an empty one would otherwise sit at the top
 * of the list with nothing to show.
 */
export async function listStaffThreads(db: typeof Database, userId: string): Promise<StaffThreadRow[]> {
    const shipper = alias(organization, "shipper");
    const carrier = alias(organization, "carrier");

    const [rows, unread] = await Promise.all([
        db
            .select({
                threadId: thread.id,
                orderId: thread.subjectId,
                lastMessageAt: thread.lastMessageAt,
                shipperName: shipper.name,
                carrierName: carrier.name,
            })
            .from(thread)
            .innerJoin(threadParticipant, and(
                eq(threadParticipant.threadId, thread.id),
                eq(threadParticipant.staff, true),
            ))
            .leftJoin(order, eq(order.orderId, thread.subjectId))
            .leftJoin(shipper, eq(shipper.id, order.shipperId))
            .leftJoin(carrier, eq(carrier.id, order.carrierId))
            .where(isNotNull(thread.lastMessageAt))
            .orderBy(desc(thread.lastMessageAt)),
        unreadRows(db, userId, eq(threadParticipant.staff, true)),
    ]);

    if (rows.length === 0) return [];

    // Latest message per thread for the list preview, on the
    // (thread_id, created_at) index — over the listed threads only, so no
    // body outside an order conversation is ever read
    const previews = await db
        .selectDistinctOn([threadMessage.threadId], {
            threadId: threadMessage.threadId,
            body: threadMessage.body,
        })
        .from(threadMessage)
        .where(inArray(threadMessage.threadId, rows.map((row) => row.threadId)))
        .orderBy(threadMessage.threadId, desc(threadMessage.createdAt));

    const previewByThread = new Map(previews.map((preview) => [preview.threadId, preview.body]));
    const unreadByThread = new Map(unread.map((row) => [row.threadId, row.count]));

    return rows.map((row) => ({
        ...row,
        lastMessage: previewByThread.get(row.threadId) ?? null,
        unread: unreadByThread.get(row.threadId) ?? 0,
    }));
}

/**
 * Whether a company is a party to a thread.
 *
 * What the attachments bucket asks before letting a member write a file into
 * `threads/<threadId>/`: the bucket has no subject of its own and no session
 * beyond the organization. The subject is resolved rather than the
 * participant rows read, so the bucket gives the same answer `sendMessage`
 * will — the cache is only reconciled when somebody opens the thread, and a
 * carrier dropped from an order must stop being able to mint upload URLs at
 * once rather than when a remaining party next looks.
 */
export async function threadParty(
    db: typeof Database,
    threadId: string,
    organizationId: string,
): Promise<boolean> {
    const [row] = await db
        .select({ subjectType: thread.subjectType, subjectId: thread.subjectId })
        .from(thread)
        .where(eq(thread.id, threadId))
        .limit(1);

    if (!row) return false;

    const resolved = await resolveThreadSubject(db, row);

    return resolved?.sides.orgIds.includes(organizationId) ?? false;
}

/** Moves this reader's cursor to now. Their own, never their company's. */
export async function markRead(db: typeof Database, userId: string, threadId: string): Promise<void> {
    const lastReadAt = new Date();

    await db
        .insert(threadRead)
        .values({ threadId, userId, lastReadAt })
        .onConflictDoUpdate({ target: [threadRead.threadId, threadRead.userId], set: { lastReadAt } });
}

/**
 * Messages somebody else wrote. `is distinct from`, not `<>`: a message whose
 * author's account was deleted has a null sender and is still news.
 */
const notSentBy = (userId: string) =>
    or(isNull(threadMessage.senderUserId), ne(threadMessage.senderUserId, userId));

/**
 * The participant rows this caller reads through. `staff` is what decides the
 * Appload side — a participant row whose organization was deleted is nobody's,
 * and must not fall into ops' lap.
 */
const mySide = (actor: Actor) =>
    actor.kind === "staff"
        ? eq(threadParticipant.staff, true)
        : eq(threadParticipant.organizationId, actor.organizationId);
