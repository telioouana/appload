"use client";

import { IconMessage, IconMessagePlus, IconSearch } from "@tabler/icons-react";

import { useFormatter, useNow, useTranslations } from "@workspace/i18n";

import { Avatar, AvatarBadge, AvatarFallback } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@workspace/ui/components/item";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";

import { cn } from "@workspace/ui/lib/utils";

import type { ConversationSummary } from "@/backend/api/routers/chats";
import { OrderStatusBadge } from "@/frontend/pages/orders/sections/order-item-shared";

export const CONVERSATION_FILTERS = ["all", "unread", "active"] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]!.toUpperCase())
        .join("") || "?";

export function ConversationList({
    conversations,
    hasAny,
    activeId,
    isLoading,
    search,
    onSearchChange,
    filter,
    onFilterChange,
    onSelect,
    onNewChat,
}: {
    /** Already filtered by the shell's search + filter state. */
    conversations: ConversationSummary[];
    /** Whether any conversation exists before filtering. */
    hasAny: boolean;
    activeId: string | null;
    isLoading: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    filter: ConversationFilter;
    onFilterChange: (value: ConversationFilter) => void;
    onSelect: (id: string) => void;
    onNewChat: () => void;
}) {
    const t = useTranslations("Admin.chats");
    const f = useFormatter();
    // Explicit now keeps relativeTime warning-free and ticks the labels over
    const now = useNow({ updateInterval: 60_000 });

    return (
        <aside className="flex w-80 shrink-0 flex-col border-r">
            <div className="flex items-start justify-between gap-2 p-4 pb-3">
                <div>
                    <h1 className="font-heading text-xl font-bold tracking-tight">{t("title")}</h1>
                    <p className="text-xs text-muted-foreground">{t("description")}</p>
                </div>
                <Button size="icon-sm" onClick={onNewChat}>
                    <IconMessagePlus />
                    <span className="sr-only">{t("list.new")}</span>
                </Button>
            </div>

            <div className="flex flex-col gap-2.5 px-3 pb-3">
                <InputGroup>
                    <InputGroupAddon>
                        <IconSearch />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={search}
                        placeholder={t("list.search")}
                        onChange={(event) => onSearchChange(event.target.value)}
                    />
                </InputGroup>
                <Tabs value={filter} onValueChange={(value) => onFilterChange(value as ConversationFilter)}>
                    <TabsList className="h-8 w-full">
                        {CONVERSATION_FILTERS.map((option) => (
                            <TabsTrigger key={option} value={option} className="text-xs">
                                {t(`list.filters.${option}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex flex-col gap-1 p-2">
                        {Array.from({ length: 5 }, (_, index) => (
                            <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                                <Skeleton className="size-9 rounded-full" />
                                <div className="flex flex-1 flex-col gap-2">
                                    <Skeleton className="h-3.5 w-3/5" />
                                    <Skeleton className="h-3 w-4/5" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : conversations.length === 0 ? (
                    hasAny ? (
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <IconSearch />
                                </EmptyMedia>
                                <EmptyTitle>{t("list.noMatchesTitle")}</EmptyTitle>
                                <EmptyDescription>{t("list.noMatchesDescription")}</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <IconMessage />
                                </EmptyMedia>
                                <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
                                <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                                <Button onClick={onNewChat}>
                                    <IconMessagePlus />
                                    {t("list.startFirst")}
                                </Button>
                            </EmptyContent>
                        </Empty>
                    )
                ) : (
                    <ItemGroup className="gap-1 p-2">
                        {conversations.map((conversation) => {
                            const isActive = conversation.id === activeId;
                            // The active thread is being read by definition, so
                            // its badge is noise (and would flicker for up to a
                            // poll cycle after markRead)
                            const showUnread = conversation.unreadCount > 0 && !isActive;

                            return (
                                <Item
                                    key={conversation.id}
                                    asChild
                                    size="sm"
                                    className={cn(
                                        "cursor-pointer hover:bg-muted/60",
                                        isActive && "bg-primary/10 hover:bg-primary/10 dark:bg-primary/15 dark:hover:bg-primary/15",
                                    )}
                                >
                                    <button type="button" onClick={() => onSelect(conversation.id)}>
                                        <ItemMedia>
                                            <Avatar className="size-9">
                                                <AvatarFallback>{initials(conversation.driverName)}</AvatarFallback>
                                                {showUnread && <AvatarBadge />}
                                            </Avatar>
                                        </ItemMedia>
                                        <ItemContent className="min-w-0">
                                            <ItemTitle className="flex w-full items-center justify-between gap-2">
                                                <span className={cn("min-w-0 truncate", showUnread && "font-semibold")}>
                                                    {conversation.driverName}
                                                </span>
                                                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                                    {f.relativeTime(conversation.lastMessageAt, now)}
                                                </span>
                                            </ItemTitle>
                                            <ItemDescription className="flex w-full items-center justify-between gap-2">
                                                <span className={cn("min-w-0 truncate", showUnread && "font-medium text-foreground")}>
                                                    {conversation.lastMessage ?? conversation.driverPhone}
                                                </span>
                                                {showUnread && (
                                                    <Badge
                                                        className="shrink-0 px-1.5"
                                                        aria-label={t("list.unreadCount", { count: conversation.unreadCount })}
                                                    >
                                                        {conversation.unreadCount}
                                                    </Badge>
                                                )}
                                            </ItemDescription>
                                            {conversation.orderStatus && (
                                                // flex, or the button row's text-align: center centers the badge
                                                <div className="mt-0.5 flex">
                                                    <OrderStatusBadge
                                                        status={conversation.orderStatus}
                                                        className="px-1.5 py-0.5 text-xs"
                                                    />
                                                </div>
                                            )}
                                        </ItemContent>
                                    </button>
                                </Item>
                            );
                        })}
                    </ItemGroup>
                )}
            </div>
        </aside>
    );
}
