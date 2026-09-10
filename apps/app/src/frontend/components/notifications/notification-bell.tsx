"use client"

import { useState } from "react"
import { IconBell } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { NotificationPopover } from "@/frontend/components/notifications/notification-popover"
import { UNREAD_POLL_MS } from "@/frontend/pages/notifications/types"

/** Past this the exact number stops meaning anything; "99+" says enough. */
const OVERFLOW = 99

/**
 * The header's seat for the notification centre: a count that keeps itself
 * up to date every thirty seconds — the portal's only heartbeat, since the
 * 60 s function cap on Hobby rules a live connection out — and the panel it
 * opens.
 */
export function NotificationBell({ className }: { className?: string }) {
    const t = useTranslations("App.notifications")
    const trpc = useTRPC()

    const [open, setOpen] = useState(false)

    const { data } = useQuery(trpc.notifications.unreadCount.queryOptions(
        undefined,
        { refetchInterval: UNREAD_POLL_MS },
    ))

    const count = data?.count ?? 0

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("relative rounded-full", className)}
                    aria-label={count > 0 ? t("bell.unread", { count }) : t("bell.label")}
                >
                    <IconBell className="size-5" stroke={1.5} />

                    {count > 0 && (
                        // The label above already says the number; on screen
                        // it is a mark, not a second announcement
                        <span aria-hidden className="absolute -top-0.5 -right-0.5">
                            <Badge className="h-4 min-w-4 px-1 text-[10px] tabular-nums">
                                {count > OVERFLOW ? t("bell.overflow", { count: OVERFLOW }) : count}
                            </Badge>
                        </span>
                    )}
                </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-88 gap-0 p-0">
                <NotificationPopover onNavigate={() => setOpen(false)} />
            </PopoverContent>
        </Popover>
    )
}
