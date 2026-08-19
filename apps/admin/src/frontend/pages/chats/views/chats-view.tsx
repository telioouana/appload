"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconCheck, IconClock, IconMessage, IconMessagePlus, IconSend } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";
import type { ChatMessage } from "@workspace/db/chats";

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { Separator } from "@workspace/ui/components/separator";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { InputGroup, InputGroupButton, InputGroupTextarea } from "@workspace/ui/components/input-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@workspace/ui/components/item";
import { Message, MessageContent, MessageAvatar, MessageFooter } from "@workspace/ui/components/message";
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";

import { cn } from "@workspace/ui/lib/utils";

import { useTRPC } from "@/backend/api/client";

import { NewChatDialog } from "./new-chat";

const CONVERSATIONS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 5_000;

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]!.toUpperCase())
        .join("") || "?";

function StatusIcon({ status }: { status: ChatMessage["status"] }) {
    if (status === "failed") {
        return <IconAlertCircle className="size-3.5 text-destructive" />;
    }
    if (status === "pending") {
        return <IconClock className="size-3.5" />;
    }
    if (status === "sent" || status === "delivered" || status === "read") {
        return <IconCheck className={cn("size-3.5", status === "read" && "text-primary")} />;
    }

    return null;
}

export function ChatsView({ configured = true }: { configured?: boolean }) {
    const t = useTranslations("Admin.chats");
    const f = useFormatter();

    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const [activeId, setActiveId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [isNewChatOpen, setNewChatOpen] = useState(false);

    // Conversation list: polls to pick up webhook-created threads
    const conversationsQuery = useQuery(
        trpc.chats.list.queryOptions(undefined, { refetchInterval: CONVERSATIONS_POLL_MS }),
    );
    const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
    const isLoadingList = conversationsQuery.isPending;

    // Active thread: polls to pick up inbound messages
    const messagesQuery = useQuery(
        trpc.chats.messages.queryOptions(
            { conversationId: activeId ?? "" },
            { enabled: !!activeId, refetchInterval: MESSAGES_POLL_MS },
        ),
    );
    const messages = (activeId && messagesQuery.data) || [];
    const isLoadingThread = !!activeId && messagesQuery.isPending;

    const sendMessage = useMutation(trpc.chats.send.mutationOptions());
    const isSending = sendMessage.isPending;

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeId) ?? null,
        [conversations, activeId],
    );

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

    return (
        <div className="flex h-[calc(100svh-2rem)] min-h-0 flex-col gap-2 my-4">
            {!configured && (
                <Alert variant="destructive">
                    <IconAlertCircle />
                    <AlertTitle>{t("unconfigured.title")}</AlertTitle>
                    <AlertDescription>{t("unconfigured.description")}</AlertDescription>
                </Alert>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden rounded-3xl border">
            {/* Conversation list */}
            <aside className="flex w-80 shrink-0 flex-col border-r">
                <div className="flex items-center justify-between gap-2 p-4">
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
                        <p className="text-xs text-muted-foreground">{t("description")}</p>
                    </div>
                    <Button size="icon-sm" onClick={() => setNewChatOpen(true)}>
                        <IconMessagePlus />
                        <span className="sr-only">{t("list.new")}</span>
                    </Button>
                </div>

                <Separator />

                <div className="flex-1 overflow-y-auto">
                    {isLoadingList ? (
                        <div className="flex justify-center py-10">
                            <Spinner className="size-5" />
                        </div>
                    ) : conversations.length === 0 ? (
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <IconMessage />
                                </EmptyMedia>
                                <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
                                <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <ItemGroup className="gap-1 p-2">
                            {conversations.map((conversation) => (
                                <Item
                                    key={conversation.id}
                                    asChild
                                    size="sm"
                                    className={cn(
                                        "cursor-pointer",
                                        conversation.id === activeId && "bg-accent",
                                    )}
                                >
                                    <button type="button" onClick={() => setActiveId(conversation.id)}>
                                        <ItemMedia>
                                            <Avatar className="size-9">
                                                <AvatarFallback>{initials(conversation.driverName)}</AvatarFallback>
                                            </Avatar>
                                        </ItemMedia>
                                        <ItemContent>
                                            <ItemTitle className="flex w-full items-center justify-between gap-2">
                                                <span className="truncate">{conversation.driverName}</span>
                                                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                                    {f.relativeTime(conversation.lastMessageAt)}
                                                </span>
                                            </ItemTitle>
                                            <ItemDescription className="truncate">
                                                {conversation.lastMessage ?? conversation.driverPhone}
                                            </ItemDescription>
                                        </ItemContent>
                                    </button>
                                </Item>
                            ))}
                        </ItemGroup>
                    )}
                </div>
            </aside>

            {/* Thread */}
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
                        <header className="flex items-center gap-3 p-4">
                            <Avatar className="size-9">
                                <AvatarFallback>{initials(activeConversation.driverName)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <div className="truncate font-medium">{activeConversation.driverName}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {activeConversation.driverPhone}
                                </div>
                            </div>
                            {activeConversation.orderId && (
                                <Badge variant="secondary" className="ml-auto">
                                    {t("thread.order")} {activeConversation.orderId}
                                </Badge>
                            )}
                        </header>

                        <Separator />

                        <MessageScrollerProvider>
                            <MessageScroller className="flex-1">
                                <MessageScrollerViewport className="px-4">
                                    <MessageScrollerContent className="gap-4 py-4">
                                        {isLoadingThread && messages.length === 0 ? (
                                            <div className="flex justify-center py-10">
                                                <Spinner className="size-5" />
                                            </div>
                                        ) : (
                                            messages.map((message) => (
                                                <MessageScrollerItem key={message.id}>
                                                    {message.direction === "outbound" ? (
                                                        <Message align="end">
                                                            <MessageContent>
                                                                <Bubble align="end">
                                                                    <BubbleContent>{message.body}</BubbleContent>
                                                                </Bubble>
                                                                <MessageFooter className="gap-1">
                                                                    {f.dateTime(message.createdAt, { hour: "2-digit", minute: "2-digit" })}
                                                                    <StatusIcon status={message.status} />
                                                                    {message.status === "failed" && (
                                                                        <span className="text-destructive">{t("thread.failed")}</span>
                                                                    )}
                                                                </MessageFooter>
                                                            </MessageContent>
                                                        </Message>
                                                    ) : (
                                                        <Message>
                                                            <MessageAvatar>
                                                                <Avatar className="size-8">
                                                                    <AvatarFallback className="text-xs">
                                                                        {initials(activeConversation.driverName)}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                            </MessageAvatar>
                                                            <MessageContent>
                                                                <Bubble variant="muted">
                                                                    <BubbleContent>{message.body}</BubbleContent>
                                                                </Bubble>
                                                                <MessageFooter>
                                                                    {f.dateTime(message.createdAt, { hour: "2-digit", minute: "2-digit" })}
                                                                </MessageFooter>
                                                            </MessageContent>
                                                        </Message>
                                                    )}
                                                </MessageScrollerItem>
                                            ))
                                        )}
                                    </MessageScrollerContent>
                                </MessageScrollerViewport>
                                <MessageScrollerButton />
                            </MessageScroller>
                        </MessageScrollerProvider>

                        <Separator />

                        <form
                            className="p-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                onSend();
                            }}
                        >
                            <InputGroup>
                                <InputGroupTextarea
                                    ref={draftRef}
                                    rows={1}
                                    value={draft}
                                    disabled={isSending}
                                    placeholder={t("thread.composer")}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" && !event.shiftKey) {
                                            event.preventDefault();
                                            onSend();
                                        }
                                    }}
                                />
                                <InputGroupButton
                                    type="submit"
                                    size="icon-sm"
                                    className="self-end"
                                    disabled={isSending || !draft.trim()}
                                >
                                    {isSending ? <Spinner className="size-4" /> : <IconSend />}
                                    <span className="sr-only">{t("thread.send")}</span>
                                </InputGroupButton>
                            </InputGroup>
                        </form>
                    </>
                )}
            </section>

                <NewChatDialog
                    open={isNewChatOpen}
                    onOpenChange={setNewChatOpen}
                    onStarted={(conversation) => {
                        setNewChatOpen(false);
                        setActiveId(conversation.id);
                        queryClient.invalidateQueries(trpc.chats.list.queryFilter());
                    }}
                />
            </div>
        </div>
    );
}
