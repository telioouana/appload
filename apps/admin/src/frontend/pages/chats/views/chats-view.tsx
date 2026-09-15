"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconInfoCircle, IconMessage } from "@tabler/icons-react";
import { toast } from "sonner";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";

import { useTRPC } from "@/backend/api/client";
import { useListParams } from "@workspace/ui/hooks/use-list-params";
import type { ConversationSummary } from "@/backend/api/routers/chats";
import { domainErrorCode } from "@workspace/trpc/errors";
import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types";

import { ChatComposer } from "@workspace/ui/customs/chat/composer";
import { ChatThread } from "@workspace/ui/customs/chat/thread-panel";

import { ConversationList, type ChatMode, type ConversationFilter } from "@/frontend/pages/chats/sections/conversation-list";
import { Thread } from "@/frontend/pages/chats/sections/thread";
import { Composer } from "@/frontend/pages/chats/sections/composer";
import { OrderPanel } from "@/frontend/pages/chats/sections/order-panel";
import {
    THREAD_ACCEPTED,
    THREAD_MAX_BYTES,
    THREAD_MAX_FILES,
    useOrderThread,
} from "@/frontend/pages/chats/hooks/use-order-thread";

import { NewChatDialog } from "./new-chat";

const CONVERSATIONS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 5_000;

// Orders that still have a truck committed, plus fresh bookings
const ACTIVE_ORDER_STATUSES = new Set<string>(ACTIVE_STATUSES);

const LOCATION_ERROR_KEYS = {
    NO_ACTIVE_ORDER: "noActiveOrder",
    SEND_FAILED: "sendFailed",
    UNKNOWN: "unknown",
} as const;
const LOCATION_ERROR_CODES = Object.keys(LOCATION_ERROR_KEYS) as (keyof typeof LOCATION_ERROR_KEYS)[];

export function ChatsView({ configured = true }: { configured?: boolean }) {
    const t = useTranslations("Admin.messages");
    const f = useFormatter();

    const trpc = useTRPC();
    const queryClient = useQueryClient();

    // The open conversation lives in the URL so the order page, the partner
    // profile and a shared link can all point at one. Written shallowly:
    // the server reads nothing from it, and this page polls
    const params = useListParams()
    const [activeId, setActiveId] = useState<string | null>(params.get("c"))
    // The order conversations are the same page's second list, with a deep
    // link of their own: a thread named in the URL is what opens on it
    const [activeThreadId, setActiveThreadId] = useState<string | null>(params.get("t"))
    const [mode, setMode] = useState<ChatMode>(params.get("t") ? "orders" : "drivers")

    const selectConversation = (id: string) => {
        setActiveId(id)
        params.shallow({ key: "c", value: id })
    };

    const selectThread = (id: string) => {
        setActiveThreadId(id)
        params.shallow({ key: "t", value: id })
    };
    const [draft, setDraft] = useState("");
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<ConversationFilter>("all");
    const [isPanelOpen, setPanelOpen] = useState(true);
    const [isNewChatOpen, setNewChatOpen] = useState(false);

    // Conversation list: polls to pick up webhook-created threads
    const conversationsQuery = useQuery(
        trpc.chats.list.queryOptions(undefined, { refetchInterval: CONVERSATIONS_POLL_MS }),
    );
    const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
    const isLoadingList = conversationsQuery.isPending;

    const visibleConversations = useMemo(() => {
        const query = search.trim().toLowerCase();
        const digits = query.replace(/\D/g, "");

        return conversations.filter((conversation) => {
            if (filter === "unread" && conversation.unreadCount === 0) {
                return false;
            }
            if (filter === "active"
                && (!conversation.orderStatus || !ACTIVE_ORDER_STATUSES.has(conversation.orderStatus))) {
                return false;
            }
            if (!query) {
                return true;
            }

            return conversation.driverName.toLowerCase().includes(query)
                || (digits.length > 0 && conversation.driverPhone.includes(digits))
                || (conversation.orderId ?? "").toLowerCase().includes(query);
        });
    }, [conversations, search, filter]);

    // The order conversations beside them, polled the same way
    const threadsQuery = useQuery(
        trpc.threads.list.queryOptions(undefined, { refetchInterval: CONVERSATIONS_POLL_MS }),
    );
    const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);
    const activeThread = useMemo(
        () => threads.find((thread) => thread.threadId === activeThreadId) ?? null,
        [threads, activeThreadId],
    );

    // Opened, read and written through the same hook the order page uses
    const orderChat = useOrderThread(mode === "orders" ? activeThread?.orderId ?? null : null);

    // Active thread: polls to pick up inbound messages
    const messagesQuery = useQuery(
        trpc.chats.messages.queryOptions(
            { conversationId: activeId ?? "" },
            { enabled: !!activeId, refetchInterval: MESSAGES_POLL_MS },
        ),
    );
    const items = (activeId && messagesQuery.data) || [];
    const isLoadingThread = !!activeId && messagesQuery.isPending;

    const sendMessage = useMutation(trpc.chats.send.mutationOptions());
    const isSending = sendMessage.isPending;

    const requestLocation = useMutation(trpc.chats.requestLocation.mutationOptions());
    const isRequestingLocation = requestLocation.isPending;

    // Read watermark: opening a thread (or new inbound arriving while it is
    // open) marks it read once. No invalidation on success — the list cache
    // is patched locally and the next poll returns the same server truth,
    // so the effect can't loop.
    const markRead = useMutation(trpc.chats.markRead.mutationOptions({
        // A failed attempt only re-fires when the unread count changes, so
        // ride out transient errors here instead
        retry: 3,
        onSuccess: (_data, variables) => {
            queryClient.setQueriesData(
                trpc.chats.list.queryFilter(),
                (old: ConversationSummary[] | undefined) => old?.map((conversation) =>
                    conversation.id === variables.conversationId
                        ? { ...conversation, unreadCount: 0 }
                        : conversation,
                ),
            );

            // The sidebar counts threads, not messages: this one just went
            // quiet, so recount now rather than at its next poll. A recount,
            // not a decrement — the badge may not have counted this thread
            // yet when the read is a fresh inbound on the open one
            void queryClient.invalidateQueries(trpc.chats.unread.queryFilter());
        },
    }));

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeId) ?? null,
        [conversations, activeId],
    );
    const activeUnread = activeConversation?.unreadCount ?? 0;

    const markReadMutate = markRead.mutate;
    useEffect(() => {
        if (activeId && activeUnread > 0) {
            markReadMutate({ conversationId: activeId });
        }
    }, [activeId, activeUnread, markReadMutate]);

    const draftRef = useRef<HTMLTextAreaElement | null>(null);

    function onSend() {
        const body = draft.trim();

        if (!body || !activeId || isSending) {
            return;
        }

        setDraft("");

        sendMessage.mutate(
            { conversationId: activeId, body },
            {
                onSettled: async () => {
                    // Refresh the thread and the list preview either way —
                    // failed sends are stored with their status too
                    await Promise.all([
                        queryClient.invalidateQueries(
                            trpc.chats.messages.queryFilter({ conversationId: activeId }),
                        ),
                        queryClient.invalidateQueries(trpc.chats.list.queryFilter()),
                    ]);
                    draftRef.current?.focus();
                },
            },
        );
    }

    function onRequestLocation() {
        if (!activeId || isRequestingLocation) {
            return;
        }

        requestLocation.mutate(
            { conversationId: activeId },
            {
                onSuccess: (result) => {
                    toast.success(result.mode === "native"
                        ? t("thread.location.sentNative")
                        : t("thread.location.sentTemplate"));
                },
                onError: (error) => {
                    const code = domainErrorCode(error, LOCATION_ERROR_CODES, "UNKNOWN");
                    toast.error(t(`thread.location.errors.${LOCATION_ERROR_KEYS[code]}`));
                },
                onSettled: async () => {
                    // The mirror row is stored even on failure — refresh either way
                    await Promise.all([
                        queryClient.invalidateQueries(
                            trpc.chats.messages.queryFilter({ conversationId: activeId }),
                        ),
                        queryClient.invalidateQueries(trpc.chats.list.queryFilter()),
                    ]);
                },
            },
        );
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden py-4">
            {!configured && (
                <Alert variant="destructive">
                    <IconAlertCircle />
                    <AlertTitle>{t("unconfigured.title")}</AlertTitle>
                    <AlertDescription>{t("unconfigured.description")}</AlertDescription>
                </Alert>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden rounded-3xl border bg-card">
                <ConversationList
                    conversations={visibleConversations}
                    hasAny={conversations.length > 0}
                    activeId={activeId}
                    isLoading={isLoadingList}
                    search={search}
                    onSearchChange={setSearch}
                    filter={filter}
                    onFilterChange={setFilter}
                    onSelect={selectConversation}
                    onNewChat={() => setNewChatOpen(true)}
                    mode={mode}
                    onModeChange={setMode}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    isLoadingThreads={threadsQuery.isPending}
                    onSelectThread={selectThread}
                />

                <section className="flex min-w-0 flex-1 flex-col">
                    {mode === "orders" ? (
                        !activeThread ? (
                            <Empty className="flex-1">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <IconMessage />
                                    </EmptyMedia>
                                    <EmptyTitle>{t("threads.emptyTitle")}</EmptyTitle>
                                    <EmptyDescription>{t("threads.emptyDescription")}</EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <>
                                <header className="flex items-center gap-3 p-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{activeThread.orderId}</div>
                                        <div className="truncate text-xs text-muted-foreground">
                                            {[activeThread.shipperName, activeThread.carrierName ?? t("threads.noCarrier")]
                                                .filter(Boolean)
                                                .join(" · ")}
                                        </div>
                                    </div>

                                    {/* The panel is one state for both lists, and
                                        the driver header's toggle is the only other
                                        one: without this, a panel closed there
                                        could not be opened here */}
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className={cn("ml-auto", isPanelOpen && "bg-muted")}
                                        aria-pressed={isPanelOpen}
                                        onClick={() => setPanelOpen((open) => !open)}
                                    >
                                        <IconInfoCircle />
                                        <span className="sr-only">{t("thread.info")}</span>
                                    </Button>
                                </header>

                                <Separator />

                                <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                                    <ChatThread
                                        messages={orderChat.messages}
                                        meUserId={orderChat.meUserId}
                                        loading={orderChat.isLoading}
                                        formatTime={(date) => f.dateTime(date, { dateStyle: "short", timeStyle: "short" })}
                                        labels={{
                                            empty: t("threads.empty"),
                                            you: t("threads.you"),
                                            loadMore: t("threads.loadMore"),
                                        }}
                                    />

                                    <ChatComposer
                                        onSend={orderChat.send}
                                        disabled={!orderChat.threadId}
                                        pending={orderChat.sending}
                                        accept={THREAD_ACCEPTED}
                                        maxBytes={THREAD_MAX_BYTES}
                                        maxFiles={THREAD_MAX_FILES}
                                        labels={{
                                            placeholder: t("threads.placeholder"),
                                            send: t("threads.send"),
                                            attach: t("threads.attach"),
                                            remove: t("threads.remove"),
                                            badType: t("threads.errors.FILE_TYPE"),
                                            tooLarge: t("threads.errors.FILE_TOO_LARGE"),
                                            tooMany: t("threads.errors.TOO_MANY_FILES"),
                                        }}
                                    />
                                </div>
                            </>
                        )
                    ) : !activeConversation ? (
                        <Empty className="flex-1">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <IconMessage />
                                </EmptyMedia>
                                <EmptyTitle>{t("thread.emptyTitle")}</EmptyTitle>
                                <EmptyDescription>{t("thread.emptyDescription")}</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <>
                            <Thread
                                conversation={activeConversation}
                                items={items}
                                isLoading={isLoadingThread}
                                panelOpen={isPanelOpen}
                                onTogglePanel={() => setPanelOpen((open) => !open)}
                            />
                            <Separator />
                            <Composer
                                draft={draft}
                                onDraftChange={setDraft}
                                onSend={onSend}
                                isSending={isSending}
                                onRequestLocation={onRequestLocation}
                                isRequestingLocation={isRequestingLocation}
                                draftRef={draftRef}
                            />
                        </>
                    )}
                </section>

                {/* The same panel either way — an order conversation is
                    already named by the order it hangs off */}
                {isPanelOpen && (mode === "orders" ? activeThread : activeConversation) && (
                    <OrderPanel
                        orderId={mode === "orders" ? activeThread?.orderId ?? null : activeConversation?.orderId ?? null}
                        onClose={() => setPanelOpen(false)}
                    />
                )}

                <NewChatDialog
                    open={isNewChatOpen}
                    onOpenChange={setNewChatOpen}
                    onStarted={(conversation) => {
                        setNewChatOpen(false);
                        selectConversation(conversation.id);
                        queryClient.invalidateQueries(trpc.chats.list.queryFilter());
                    }}
                />
            </div>
        </div>
    );
}
