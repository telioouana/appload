"use client";

import { useMemo } from "react";
import {
    IconAlertCircle,
    IconCheck,
    IconChecks,
    IconClock,
    IconExternalLink,
    IconInfoCircle,
    IconMapPin,
} from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";
import type { ChatMessage } from "@workspace/db/chats";

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Bubble, BubbleContent, BubbleGroup } from "@workspace/ui/components/bubble";
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@workspace/ui/components/message";
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { Separator } from "@workspace/ui/components/separator";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";

import { cn } from "@workspace/ui/lib/utils";

import type { ConversationSummary, ThreadItem } from "@/backend/api/routers/chats";
import { Link } from "@/i18n/navigation";
import { buildThreadRows, calendarDaysAgo, parseLocation, type ThreadRow } from "@/frontend/pages/chats/lib/thread-rows";
import { initials } from "@/frontend/pages/chats/sections/conversation-list";

function StatusIcon({ status }: { status: ChatMessage["status"] }) {
    if (status === "failed") {
        return <IconAlertCircle className="size-3.5 text-destructive" />;
    }
    if (status === "pending") {
        return <IconClock className="size-3.5" />;
    }
    if (status === "sent") {
        return <IconCheck className="size-3.5" />;
    }
    if (status === "delivered" || status === "read") {
        return <IconChecks className={cn("size-3.5", status === "read" && "text-primary")} />;
    }

    return null;
}

function MessageBody({ message }: { message: ChatMessage }) {
    // Inbound location shares arrive as "📍 place — <maps url>" bodies —
    // surface them as a tappable pin instead of a raw link
    const location = message.direction === "inbound" ? parseLocation(message.body) : null;
    const t = useTranslations("Admin.chats");

    if (!location) {
        return <BubbleContent>{message.body}</BubbleContent>;
    }

    return (
        <BubbleContent asChild>
            <a
                href={location.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 font-medium"
            >
                <IconMapPin className="size-4 shrink-0 text-primary" />
                <span className="truncate underline decoration-muted-foreground underline-offset-3">
                    {location.label || t("thread.openMap")}
                </span>
                <IconExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
        </BubbleContent>
    );
}

export function Thread({
    conversation,
    items,
    isLoading,
    panelOpen,
    onTogglePanel,
}: {
    conversation: ConversationSummary;
    items: ThreadItem[];
    isLoading: boolean;
    panelOpen: boolean;
    onTogglePanel: () => void;
}) {
    const t = useTranslations("Admin.chats");
    const statusLabels = useTranslations("Admin.orders.header.filters.status.options");
    const f = useFormatter();

    const rows = useMemo(() => buildThreadRows(items), [items]);

    function dividerLabel(date: Date) {
        const daysAgo = calendarDaysAgo(date);

        if (daysAgo === 0) {
            return t("thread.dividers.today");
        }
        if (daysAgo === 1) {
            return t("thread.dividers.yesterday");
        }

        return f.dateTime(date, {
            day: "numeric",
            month: "long",
            ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
        });
    }

    function groupRow(row: Extract<ThreadRow, { type: "group" }>) {
        const last = row.messages.at(-1)!;
        const time = f.dateTime(last.createdAt, { hour: "2-digit", minute: "2-digit" });

        if (row.direction === "outbound") {
            return (
                <Message align="end">
                    <MessageContent>
                        <BubbleGroup className="items-end gap-1">
                            {row.messages.map((message) => (
                                <Bubble key={message.id} variant="tinted" align="end">
                                    <MessageBody message={message} />
                                </Bubble>
                            ))}
                        </BubbleGroup>
                        <MessageFooter className="gap-1">
                            {time}
                            <StatusIcon status={last.status} />
                            {last.status === "failed" && (
                                <span className="text-destructive">{t("thread.failed")}</span>
                            )}
                        </MessageFooter>
                    </MessageContent>
                </Message>
            );
        }

        return (
            <Message>
                <MessageAvatar>
                    <Avatar className="size-8">
                        <AvatarFallback className="text-xs">
                            {initials(conversation.driverName)}
                        </AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <MessageHeader>{conversation.driverName}</MessageHeader>
                    <BubbleGroup className="gap-1">
                        {row.messages.map((message) => (
                            <Bubble key={message.id} variant="muted">
                                <MessageBody message={message} />
                            </Bubble>
                        ))}
                    </BubbleGroup>
                    <MessageFooter>{time}</MessageFooter>
                </MessageContent>
            </Message>
        );
    }

    return (
        <>
            <header className="flex items-center gap-3 p-4">
                <Avatar size="lg">
                    <AvatarFallback>{initials(conversation.driverName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <div className="truncate font-medium">{conversation.driverName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                        {conversation.driverPhone}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="outline" className="gap-1.5">
                                <span
                                    className={cn(
                                        "size-2 rounded-full",
                                        conversation.sessionOpen ? "bg-emerald-500" : "bg-muted-foreground/40",
                                    )}
                                />
                                {conversation.sessionOpen ? t("thread.session.open") : t("thread.session.closed")}
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                            {conversation.sessionOpen ? t("thread.session.openHint") : t("thread.session.closedHint")}
                        </TooltipContent>
                    </Tooltip>
                    {conversation.orderId && (
                        <Badge variant="secondary" asChild>
                            <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: conversation.orderId } }}>
                                {conversation.orderId}
                                <IconExternalLink />
                            </Link>
                        </Badge>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-pressed={panelOpen}
                                className={cn(panelOpen && "bg-muted")}
                                onClick={onTogglePanel}
                            >
                                <IconInfoCircle />
                                <span className="sr-only">{t("thread.info")}</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("thread.info")}</TooltipContent>
                    </Tooltip>
                </div>
            </header>

            <Separator />

            <MessageScrollerProvider autoScroll>
                <MessageScroller className="flex-1">
                    <MessageScrollerViewport className="px-4">
                        <MessageScrollerContent className="gap-3 py-4">
                            {isLoading && items.length === 0 ? (
                                <div className="flex justify-center py-10">
                                    <Spinner className="size-5" />
                                </div>
                            ) : (
                                rows.map((row) => (
                                    <MessageScrollerItem key={row.key} messageId={row.key}>
                                        {row.type === "divider" ? (
                                            <div className="flex justify-center">
                                                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                                                    {dividerLabel(row.date)}
                                                </span>
                                            </div>
                                        ) : row.type === "status" ? (
                                            <div className="flex justify-center">
                                                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                                                    {row.event.fromStatus
                                                        ? t("thread.status.changed", {
                                                            from: statusLabels(row.event.fromStatus),
                                                            to: statusLabels(row.event.toStatus),
                                                        })
                                                        : t("thread.status.created", {
                                                            to: statusLabels(row.event.toStatus),
                                                        })}
                                                    {" · "}
                                                    {f.dateTime(row.event.createdAt, { hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                            </div>
                                        ) : (
                                            groupRow(row)
                                        )}
                                    </MessageScrollerItem>
                                ))
                            )}
                        </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <MessageScrollerButton />
                </MessageScroller>
            </MessageScrollerProvider>
        </>
    );
}
