"use client"

import { useEffect, useMemo, useRef } from "react"
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "sonner"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { useEdgeStore } from "@workspace/edgestore/client"
import { threadAttachmentPath } from "@workspace/edgestore/path"
import type { ThreadSubject } from "@workspace/db/types"

import { domainErrorCode } from "@workspace/trpc/errors"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { ChatComposer } from "@workspace/ui/customs/chat/composer"
import { ChatThread, type ChatMessageItem } from "@workspace/ui/customs/chat/thread-panel"

import { useTRPC } from "@/backend/api/client"

/** How often the open conversation asks for what has been said since. */
const THREAD_POLL_MS = 5_000

/** What the bucket takes, and what the send mutation will accept. */
type AttachmentMime = "application/pdf" | "image/jpeg" | "image/png"

const ACCEPTED: AttachmentMime[] = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

const isAccepted = (type: string): type is AttachmentMime => (ACCEPTED as string[]).includes(type)

const SEND_ERROR_CODES = [
    "RATE_LIMITED",
    "EMPTY_MESSAGE",
    "INVALID_ATTACHMENT_URL",
    "THREAD_NOT_FOUND",
    "UPLOAD_FAILED",
    "UNKNOWN",
] as const

type SendErrorCode = (typeof SEND_ERROR_CODES)[number]

/**
 * The conversation on one shipment, in the portal.
 *
 * Both parties write here — the shipper and the booked carrier on an Appload
 * order, the owner and the executing partner on a load — and Appload's ops
 * are in the room on an order only. A reader who is not a party is not told
 * the thread exists: `threads.get` answers NOT_FOUND and the card renders
 * nothing at all.
 *
 * The thread is opened once (which is what creates it); only the messages
 * are polled, so a card left open does not re-assert the participants every
 * five seconds.
 */
export function ChatCard({ subjectType, subjectId }: { subjectType: ThreadSubject; subjectId: string }) {
    const t = useTranslations("App.threads")
    const f = useFormatter()

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()

    const subject = { subjectType, subjectId }

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const thread = useQuery(trpc.threads.get.queryOptions(subject, { retry: false }))
    const messages = useQuery(trpc.threads.messages.queryOptions(subject, {
        enabled: Boolean(thread.data),
        refetchInterval: THREAD_POLL_MS,
    }))

    const send = useMutation(trpc.threads.send.mutationOptions())
    // The rail's Chats badge and the list beside this card both count off this
    // cursor, so both are recounted when it moves
    const recount = () => Promise.all([
        queryClient.invalidateQueries(trpc.threads.list.queryFilter()),
        queryClient.invalidateQueries(trpc.threads.unread.queryFilter()),
    ])
    const markRead = useMutation(trpc.threads.markRead.mutationOptions({ onSuccess: recount }))

    // Who said what, with each sender's company beside their name. Staff have
    // no organization row: the null side IS Appload
    const orgNames = useMemo(() => new Map(
        (thread.data?.participants ?? []).map((party) => [party.organizationId, party.name]),
    ), [thread.data])

    const items: ChatMessageItem[] = (messages.data ?? []).map((message) => ({
        id: message.id,
        body: message.body,
        attachments: message.attachments,
        senderUserId: message.senderUserId,
        senderName: message.senderName,
        senderOrg: message.senderOrgId === null
            ? t("appload")
            : orgNames.get(message.senderOrgId) ?? null,
        createdAt: message.createdAt,
    }))

    // Read on open and whenever somebody else's message lands while the card
    // is on screen. Keyed on that message's id, so the effect fires once per
    // arrival rather than on every poll
    const newest = items[0]
    const inbound = newest && newest.senderUserId !== session.user.id ? newest.id : null
    const marked = useRef<string | null>(null)
    const markReadMutate = markRead.mutate

    useEffect(() => {
        if (!inbound || marked.current === inbound) return

        marked.current = inbound
        markReadMutate({ subjectType, subjectId })
    }, [inbound, markReadMutate, subjectType, subjectId])

    if (thread.isError || (!thread.isPending && !thread.data)) return null

    const threadId = thread.data?.threadId

    async function onSend(body: string, files: File[]): Promise<boolean> {
        if (!threadId) return false

        const attachments: { url: string; name: string; size: number; mimeType: AttachmentMime }[] = []

        try {
            for (const file of files) {
                if (!isAccepted(file.type)) {
                    toast.error(t("errors.FILE_TYPE"))
                    return false
                }

                // Not confirmed until the message exists, so a refused send
                // leaves blobs that expire on their own
                const result = await edgestore.threadFiles.upload({
                    file,
                    input: { path: threadAttachmentPath(threadId) },
                    options: { temporary: true },
                })

                if (!result?.url) {
                    toast.error(t("errors.UPLOAD_FAILED"))
                    return false
                }

                attachments.push({ url: result.url, name: file.name, size: file.size, mimeType: file.type })
            }

            await send.mutateAsync({ subjectType, subjectId, body, attachments })

            try {
                await Promise.all(attachments.map((file) => edgestore.threadFiles.confirmUpload({ url: file.url })))
            } catch (cause) {
                // The message is already in the thread: a failed confirm costs
                // the files a day from now, not this send — and telling the
                // writer it failed would only have them say it twice
                console.error("edgestore: confirm thread attachment", cause)
            }

            await queryClient.invalidateQueries(trpc.threads.messages.queryFilter(subject))
            // Sending moves the conversation to the top of the list, and
            // reads it on the way
            await recount()

            return true
        } catch (cause) {
            toast.error(t(`errors.${domainErrorCode<SendErrorCode>(cause, SEND_ERROR_CODES, "UNKNOWN")}`))

            return false
        }
    }

    return (
        <SectionCard title={thread.data?.label ?? t("title")} className="h-full min-h-0">
            <div className="flex min-h-0 flex-1 flex-col gap-2">
                <ChatThread
                    messages={items}
                    meUserId={session.user.id}
                    loading={messages.isPending}
                    formatTime={(date) => f.dateTime(date, { dateStyle: "short", timeStyle: "short" })}
                    labels={{ empty: t("empty"), you: t("you"), loadMore: t("load-more") }}
                />

                <ChatComposer
                    onSend={onSend}
                    disabled={!threadId}
                    pending={send.isPending}
                    accept={ACCEPTED}
                    maxBytes={MAX_BYTES}
                    maxFiles={MAX_FILES}
                    labels={{
                        placeholder: t("placeholder"),
                        send: t("send"),
                        attach: t("attach"),
                        remove: t("remove"),
                        badType: t("errors.FILE_TYPE"),
                        tooLarge: t("errors.FILE_TOO_LARGE"),
                        tooMany: t("errors.TOO_MANY_FILES"),
                    }}
                />
            </div>
        </SectionCard>
    )
}
