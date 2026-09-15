"use client"

import { IconFileText } from "@tabler/icons-react"

import { Bubble, BubbleContent, BubbleGroup } from "@workspace/ui/components/bubble"
import { Button } from "@workspace/ui/components/button"
import {
    Attachment,
    AttachmentContent,
    AttachmentDescription,
    AttachmentMedia,
    AttachmentTitle,
    AttachmentTrigger,
} from "@workspace/ui/components/attachment"
import { Message, MessageContent, MessageFooter, MessageHeader } from "@workspace/ui/components/message"
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { Spinner } from "@workspace/ui/components/spinner"

import { cn } from "@workspace/ui/lib/utils"

/** One file hung off a message, as it was stored — both facts optional there. */
export type ChatAttachment = {
    url: string
    name: string
    size?: number
    mimeType?: string
}

/**
 * One line of a conversation. The sender's company is resolved by the page
 * that owns the thread — this package knows nothing of organizations, and
 * "Appload" is a label like any other.
 */
export type ChatMessageItem = {
    id: string
    body: string
    attachments: ChatAttachment[]
    senderUserId: string | null
    senderName: string | null
    /** The company the sender wrote for, or the staff side's label */
    senderOrg: string | null
    createdAt: Date
}

export type ChatThreadLabels = {
    /** Nobody has written into this shipment yet */
    empty: string
    /** What this reader's own bubbles are headed with */
    you: string
    loadMore: string
}

/**
 * The conversation on one shipment, whoever is reading it.
 *
 * Props only: the queries, the polling and the translations belong to the
 * page — Admin and the portal mount the same panel against their own
 * routers. Messages arrive newest first (the order both `listMessages` and
 * its `before` paging return) and are drawn oldest at the top, which is
 * where the scroller pins itself.
 */
export function ChatThread({
    messages,
    meUserId,
    labels,
    formatTime,
    loading = false,
    hasMore = false,
    onLoadMore,
    className,
}: {
    messages: ChatMessageItem[]
    /** Whose bubbles sit on the right — the reader's own, never their company's */
    meUserId: string
    labels: ChatThreadLabels
    formatTime: (date: Date) => string
    loading?: boolean
    hasMore?: boolean
    onLoadMore?: () => void
    className?: string
}) {
    const ordered = [...messages].reverse()

    return (
        <MessageScrollerProvider autoScroll>
            <MessageScroller className={cn("flex-1", className)}>
                <MessageScrollerViewport className="px-1">
                    <MessageScrollerContent className="gap-3 py-2">
                        {loading && ordered.length === 0 ? (
                            <div className="flex justify-center py-10">
                                <Spinner className="size-5" />
                            </div>
                        ) : ordered.length === 0 ? (
                            <p className="text-muted-foreground py-10 text-center text-xs">{labels.empty}</p>
                        ) : (
                            <>
                                {hasMore && onLoadMore && (
                                    <div className="flex justify-center">
                                        <Button variant="ghost" size="sm" onClick={onLoadMore}>
                                            {labels.loadMore}
                                        </Button>
                                    </div>
                                )}

                                {ordered.map((message) => {
                                    const mine = message.senderUserId === meUserId

                                    return (
                                        <MessageScrollerItem key={message.id} messageId={message.id}>
                                            <Message align={mine ? "end" : "start"}>
                                                <MessageContent>
                                                    <MessageHeader>
                                                        {mine
                                                            ? labels.you
                                                            : [message.senderName, message.senderOrg]
                                                                .filter(Boolean)
                                                                .join(" · ")}
                                                    </MessageHeader>

                                                    <BubbleGroup className="gap-1">
                                                        {message.body && (
                                                            <Bubble
                                                                variant={mine ? "tinted" : "muted"}
                                                                align={mine ? "end" : "start"}
                                                            >
                                                                <BubbleContent className="whitespace-pre-wrap">
                                                                    {message.body}
                                                                </BubbleContent>
                                                            </Bubble>
                                                        )}

                                                        {message.attachments.map((file) => (
                                                            <AttachmentLink key={file.url} file={file} />
                                                        ))}
                                                    </BubbleGroup>

                                                    <MessageFooter>{formatTime(message.createdAt)}</MessageFooter>
                                                </MessageContent>
                                            </Message>
                                        </MessageScrollerItem>
                                    )
                                })}
                            </>
                        )}
                    </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
            </MessageScroller>
        </MessageScrollerProvider>
    )
}

/**
 * A file in the conversation: a picture shows itself, anything else shows
 * the paper icon. Both open in a new tab — the object is served straight
 * from storage, so there is nothing to render in place.
 */
function AttachmentLink({ file }: { file: ChatAttachment }) {
    const isImage = file.mimeType?.startsWith("image/") ?? /\.(png|jpe?g)(\?|$)/i.test(file.url)

    return (
        <Attachment size="sm" className="max-w-64">
            <AttachmentMedia variant={isImage ? "image" : "icon"}>
                {isImage ? (
                    <img src={file.url} alt={file.name} />
                ) : (
                    <IconFileText stroke={1.5} />
                )}
            </AttachmentMedia>
            <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                {file.size !== undefined && (
                    <AttachmentDescription>{formatBytes(file.size)}</AttachmentDescription>
                )}
            </AttachmentContent>
            <AttachmentTrigger asChild>
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                    <span className="sr-only">{file.name}</span>
                </a>
            </AttachmentTrigger>
        </Attachment>
    )
}

/** A size a person reads, not a byte count. */
function formatBytes(size: number): string {
    return size >= 1024 * 1024
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(size / 1024))} KB`
}
