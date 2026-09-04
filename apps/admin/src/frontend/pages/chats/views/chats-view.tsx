"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconMessage } from "@tabler/icons-react";
import { toast } from "sonner";

import { useTranslations } from "@workspace/i18n";

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty";
import { Separator } from "@workspace/ui/components/separator";

import { useTRPC } from "@/backend/api/client";
import { useListParams } from "@/components/list/use-list-params";
import type { ConversationSummary } from "@/backend/api/routers/chats";
import { domainErrorCode } from "@/lib/trpc-error";
import { TRACKED_STATUSES } from "@/lib/tracking/statuses";

import { ConversationList, type ConversationFilter } from "@/frontend/pages/chats/sections/conversation-list";
import { Thread } from "@/frontend/pages/chats/sections/thread";
import { Composer } from "@/frontend/pages/chats/sections/composer";
import { OrderPanel } from "@/frontend/pages/chats/sections/order-panel";

import { NewChatDialog } from "./new-chat";

const CONVERSATIONS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 5_000;

// Orders that still have a truck committed, plus fresh bookings
const ACTIVE_ORDER_STATUSES = new Set<string>(["booked", ...TRACKED_STATUSES]);

const LOCATION_ERROR_KEYS = {
    NO_ACTIVE_ORDER: "noActiveOrder",
    SEND_FAILED: "sendFailed",
    UNKNOWN: "unknown",
} as const;
const LOCATION_ERROR_CODES = Object.keys(LOCATION_ERROR_KEYS) as (keyof typeof LOCATION_ERROR_KEYS)[];

export function ChatsView({ configured = true }: { configured?: boolean }) {
    const t = useTranslations("Admin.chats");

    const trpc = useTRPC();
    const queryClient = useQueryClient();

    // The open conversation lives in the URL so the order page, the partner
    // profile and a shared link can all point at one. Written shallowly:
    // the server reads nothing from it, and this page polls
    const params = useListParams()
    const [activeId, setActiveId] = useState<string | null>(params.get("c"))

    const selectConversation = (id: string) => {
        setActiveId(id)
        params.shallow({ key: "c", value: id })
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
                />

                <section className="flex min-w-0 flex-1 flex-col">
                    {!activeConversation ? (
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

                {isPanelOpen && activeConversation && (
                    <OrderPanel
                        orderId={activeConversation.orderId}
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
