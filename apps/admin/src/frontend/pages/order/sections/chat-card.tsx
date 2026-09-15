"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { ChatComposer } from "@workspace/ui/customs/chat/composer"
import { ChatThread } from "@workspace/ui/customs/chat/thread-panel"

import {
    THREAD_ACCEPTED,
    THREAD_MAX_BYTES,
    THREAD_MAX_FILES,
    useOrderThread,
} from "@/frontend/pages/chats/hooks/use-order-thread"

/**
 * The order's conversation, beside the map: the shipper, the carrier once it
 * holds the job, and whoever at Appload is looking. The driver stays on
 * WhatsApp — that thread is the Messages page.
 */
export function ChatCard({ orderId }: { orderId: string }) {
    const t = useTranslations("Admin.orders.detailPage.chat")
    const labels = useTranslations("Admin.messages.threads")
    const f = useFormatter()

    const chat = useOrderThread(orderId)

    // An order whose thread cannot be opened — no such order, or a reader who
    // is not in the room — shows nothing rather than a card that can never be
    // written in
    if (chat.unavailable) return null

    return (
        <SectionCard title={t("title")}>
            <div className="flex h-80 flex-col gap-2">
                <ChatThread
                    messages={chat.messages}
                    meUserId={chat.meUserId}
                    loading={chat.isLoading}
                    formatTime={(date) => f.dateTime(date, { dateStyle: "short", timeStyle: "short" })}
                    labels={{
                        empty: labels("empty"),
                        you: labels("you"),
                        loadMore: labels("loadMore"),
                    }}
                />

                <ChatComposer
                    onSend={chat.send}
                    disabled={!chat.threadId}
                    pending={chat.sending}
                    accept={THREAD_ACCEPTED}
                    maxBytes={THREAD_MAX_BYTES}
                    maxFiles={THREAD_MAX_FILES}
                    labels={{
                        placeholder: labels("placeholder"),
                        send: labels("send"),
                        attach: labels("attach"),
                        remove: labels("remove"),
                        badType: labels("errors.FILE_TYPE"),
                        tooLarge: labels("errors.FILE_TOO_LARGE"),
                        tooMany: labels("errors.TOO_MANY_FILES"),
                    }}
                />
            </div>
        </SectionCard>
    )
}
