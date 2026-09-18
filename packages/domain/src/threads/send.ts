import "server-only";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import type { db as Database } from "@workspace/db/db";
import { thread, threadMessage, type ThreadMessage } from "@workspace/db/threads";
import { user } from "@workspace/db/users";

import { notify } from "@workspace/domain/notifications";
import type { Actor } from "@workspace/domain/orders/actor";
import { resolveThreadSubject, threadAccess, type ThreadSubjectRef } from "@workspace/domain/threads/access";
import { ensureThread, markRead } from "@workspace/domain/threads/queries";

/** What the composer accepts: a delivery note, a photo of the load, a PDF. */
const ATTACHMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/**
 * Per file. The bucket declares no ceiling of its own, so this is a bound on
 * what a client may claim, not proof of what was stored.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Per message. Both are room to spare for what a chat actually carries. */
const MAX_ATTACHMENTS = 5;
const MAX_BODY = 4_000;

/** How much of a message travels into the recipient's notification. */
const PREVIEW_LENGTH = 120;

/** The delivery host EdgeStore serves public objects from. */
const STORAGE_HOST = process.env.EDGE_STORE_PUBLIC_HOST || "files.edgestore.dev";

/** Pinned when set, so another EdgeStore project's URL cannot pass for ours. */
const STORAGE_PROJECT_ID = process.env.EDGE_STORE_PROJECT_ID;

/**
 * One file hung off a message, as the client submits it. The URL is checked
 * separately against the thread it is being posted to — the shape being valid
 * says nothing about where the bytes live, and the type and size are what the
 * uploader says they are: display metadata the bucket is the real gate on.
 */
export const ThreadAttachmentSchema = z.object({
    url: z.url(),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
    mimeType: z.enum(ATTACHMENT_MIME_TYPES),
});

/** The message part of both apps' `send` input; each adds its own subject. */
export const ThreadMessageInputSchema = z.object({
    body: z.string().max(MAX_BODY).default(""),
    attachments: z.array(ThreadAttachmentSchema).max(MAX_ATTACHMENTS).default([]),
});

/**
 * Whether an attachment URL is one of ours, uploaded into THIS thread.
 *
 * Shaped like `isKycUrl`, and for the same reason: stored text becomes an
 * href somebody else's browser follows, so the host, the project and the
 * folder are all pinned. The thread segment is what stops a party to one
 * shipment from posting a file that was uploaded against another — the
 * uploader writes to `threads/<threadId>/`, and nothing else is accepted
 * here.
 */
export function assertThreadAttachmentUrl(url: string, threadId: string): void {
    let ok = false;

    try {
        const parsed = new URL(url);

        // Credentials and a custom port never appear on a real storage URL,
        // and both are classic ways to make a host check read wrong
        if (!parsed.username && !parsed.password && !parsed.port
            && parsed.protocol === "https:" && parsed.hostname === STORAGE_HOST) {
            const path = decodeURIComponent(parsed.pathname);

            ok = (!STORAGE_PROJECT_ID || path.startsWith(`/${STORAGE_PROJECT_ID}/`))
                && path.includes("/_public/")
                && path.includes(`/threads/${threadId}/`);
        }
    } catch {
        ok = false;
    }

    if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_ATTACHMENT_URL" });
}

export type SendMessageInput = {
    actor: Actor;
    subject: ThreadSubjectRef;
    body: string;
    attachments: z.infer<typeof ThreadAttachmentSchema>[];
};

/**
 * Posts one message into the thread of a shipment.
 *
 * The one write door, shared by both apps: the subject decides who is a
 * party (a carrier dropped from an order stops being able to write to it the
 * moment the row says so), the thread is created on first message, and the
 * other side's members are told. The sender's own cursor moves with it, so
 * their own message never comes back to them as unread.
 *
 * `email: false` on the notification by decision (plan D12): a chat is read
 * in the app, and one mail per line would be unusable.
 */
export async function sendMessage(db: typeof Database, input: SendMessageInput): Promise<ThreadMessage> {
    const { actor } = input;
    const resolved = await resolveThreadSubject(db, input.subject);

    // Same answer as "no such shipment": being told a thread exists is
    // already something an outsider should not learn
    if (!resolved || !threadAccess(actor, resolved.sides)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "THREAD_NOT_FOUND" });
    }

    const body = input.body.trim();

    if (!body && input.attachments.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "EMPTY_MESSAGE" });
    }

    const threadId = await ensureThread(db, resolved.subject, resolved.sides);

    for (const attachment of input.attachments) {
        assertThreadAttachmentUrl(attachment.url, threadId);
    }

    const senderOrgId = actor.kind === "staff" ? null : actor.organizationId;

    const [message] = await db
        .insert(threadMessage)
        .values({
            threadId,
            senderUserId: actor.userId,
            senderOrgId,
            body,
            attachments: input.attachments,
        })
        .returning();

    if (!message) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "MESSAGE_NOT_SENT" });

    await Promise.all([
        // What the thread list sorts on, so listing conversations needs no
        // join onto the messages
        db.update(thread).set({ lastMessageAt: message.createdAt }).where(eq(thread.id, threadId)),
        markRead(db, actor.userId, threadId),
    ]);

    const [sender] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, actor.userId))
        .limit(1);

    // Everyone but the side that just spoke. Staff have no notification
    // centre of their own — the admin's Messages page is where they see this
    const recipients = resolved.sides.orgIds.filter((orgId) => orgId !== senderOrgId);

    await Promise.all(recipients.map((organizationId) => {
        // Each side is told about the shipment as its own books hold it: the
        // executing partner works from its own row, and the owner's row is on
        // none of its lists (`announceDispute` addresses recipients the same)
        const target = resolved.executor?.organizationId === organizationId
            ? resolved.executor
            : { subjectId: resolved.subject.subjectId, label: resolved.label };

        return notify(db, {
            organizationId,
            kind: "thread.message",
            entityType: resolved.subject.subjectType,
            entityId: target.subjectId,
            params: {
                reference: target.label,
                senderName: sender?.name ?? "",
                preview: body.slice(0, PREVIEW_LENGTH),
                attachments: input.attachments.length,
            },
            // One row per message per recipient, however often a retry replays it
            dedupeKey: `thread-message:${message.id}`,
            email: false,
        });
    }));

    return message;
}
