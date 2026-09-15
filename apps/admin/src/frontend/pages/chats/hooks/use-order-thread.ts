"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTranslations } from "@workspace/i18n";
import { authClient } from "@workspace/auth/client";
import { useEdgeStore } from "@workspace/edgestore/client";
import { threadAttachmentPath } from "@workspace/edgestore/path";

import { domainErrorCode } from "@workspace/trpc/errors";
import type { ChatMessageItem } from "@workspace/ui/customs/chat/thread-panel";

import { useTRPC } from "@/backend/api/client";

/** How often an open conversation asks for what has been said since. */
export const THREAD_POLL_MS = 5_000;

/** What the bucket takes, and what the send mutation will accept. */
export type AttachmentMime = "application/pdf" | "image/jpeg" | "image/png";

export const THREAD_ACCEPTED: AttachmentMime[] = ["application/pdf", "image/jpeg", "image/png"];
export const THREAD_MAX_BYTES = 10 * 1024 * 1024;
export const THREAD_MAX_FILES = 5;

const isAccepted = (type: string): type is AttachmentMime => (THREAD_ACCEPTED as string[]).includes(type);

const SEND_ERROR_CODES = [
    "EMPTY_MESSAGE",
    "INVALID_ATTACHMENT_URL",
    "THREAD_NOT_FOUND",
    "UPLOAD_FAILED",
    "UNKNOWN",
] as const;

type SendErrorCode = (typeof SEND_ERROR_CODES)[number];

/**
 * One order's conversation, from Appload's side: the order page's card and
 * the Messages page's centre pane are the same thread read the same way.
 *
 * The thread is opened once — which is what creates it — and only the
 * messages are polled, so a window left open does not re-assert the
 * participants every five seconds. Reading is per person: the cursor moves
 * when this reader is looking at somebody else's message.
 */
export function useOrderThread(orderId: string | null) {
    const t = useTranslations("Admin.messages.threads");

    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const { edgestore } = useEdgeStore();

    const { data: session } = authClient.useSession();
    const meUserId = session?.user.id ?? "";

    const subject = { subjectType: "order" as const, subjectId: orderId ?? "" };
    const enabled = Boolean(orderId);

    const thread = useQuery(trpc.threads.get.queryOptions(subject, { enabled, retry: false }));
    const messages = useQuery(trpc.threads.messages.queryOptions(subject, {
        enabled: enabled && Boolean(thread.data),
        refetchInterval: THREAD_POLL_MS,
    }));

    const send = useMutation(trpc.threads.send.mutationOptions());
    const markRead = useMutation(trpc.threads.markRead.mutationOptions({
        onSuccess: () => {
            // The rail's badge and the list's pill both count off this
            // cursor, so they recount rather than wait for their own poll
            void queryClient.invalidateQueries(trpc.threads.unread.queryFilter());
            void queryClient.invalidateQueries(trpc.threads.list.queryFilter());
        },
    }));

    // Who said what, with each sender's company beside their name. Staff have
    // no organization row: the null side IS Appload
    const orgNames = useMemo(() => new Map(
        (thread.data?.participants ?? []).map((party) => [party.organizationId, party.name]),
    ), [thread.data]);

    const items: ChatMessageItem[] = useMemo(() => (messages.data ?? []).map((message) => ({
        id: message.id,
        body: message.body,
        attachments: message.attachments,
        senderUserId: message.senderUserId,
        senderName: message.senderName,
        senderOrg: message.senderOrgId === null ? t("appload") : orgNames.get(message.senderOrgId) ?? null,
        createdAt: message.createdAt,
    })), [messages.data, orgNames, t]);

    // Read on open and whenever somebody else's message lands while the
    // conversation is on screen. Keyed on that message's id, so the effect
    // fires once per arrival rather than on every poll
    const newest = items[0];
    const inbound = newest && newest.senderUserId !== meUserId ? newest.id : null;
    const marked = useRef<string | null>(null);
    const markReadMutate = markRead.mutate;

    useEffect(() => {
        if (!orderId || !inbound || marked.current === inbound) return;

        marked.current = inbound;
        markReadMutate({ subjectType: "order", subjectId: orderId });
    }, [orderId, inbound, markReadMutate]);

    const threadId = thread.data?.threadId ?? null;

    async function onSend(body: string, files: File[]): Promise<boolean> {
        if (!orderId || !threadId) return false;

        const attachments: { url: string; name: string; size: number; mimeType: AttachmentMime }[] = [];

        try {
            for (const file of files) {
                if (!isAccepted(file.type)) {
                    toast.error(t("errors.FILE_TYPE"));
                    return false;
                }

                // Not confirmed until the message exists, so a refused send
                // leaves blobs that expire on their own
                const result = await edgestore.threadFiles.upload({
                    file,
                    input: { path: threadAttachmentPath(threadId) },
                    options: { temporary: true },
                });

                if (!result?.url) {
                    toast.error(t("errors.UPLOAD_FAILED"));
                    return false;
                }

                attachments.push({ url: result.url, name: file.name, size: file.size, mimeType: file.type });
            }

            await send.mutateAsync({ subjectType: "order", subjectId: orderId, body, attachments });

            try {
                await Promise.all(attachments.map((file) => edgestore.threadFiles.confirmUpload({ url: file.url })));
            } catch (cause) {
                // The message is already in the thread: a failed confirm costs
                // the files a day from now, not this send — and telling the
                // writer it failed would only have them say it twice
                console.error("edgestore: confirm thread attachment", cause);
            }

            await Promise.all([
                queryClient.invalidateQueries(trpc.threads.messages.queryFilter(subject)),
                queryClient.invalidateQueries(trpc.threads.list.queryFilter()),
            ]);

            return true;
        } catch (cause) {
            toast.error(t(`errors.${domainErrorCode<SendErrorCode>(cause, SEND_ERROR_CODES, "UNKNOWN")}`));

            return false;
        }
    }

    return {
        /** Null while it loads, and for an order this reader may not open */
        threadId,
        unavailable: thread.isError,
        meUserId,
        messages: items,
        isLoading: messages.isPending,
        send: onSend,
        sending: send.isPending,
    };
}
