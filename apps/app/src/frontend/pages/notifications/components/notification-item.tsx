"use client"

import { IconChevronRight } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useRouter } from "@/i18n/navigation"
import { useNotificationMutations } from "@/frontend/pages/notifications/hooks/use-notification-mutations"
import { icuValues, kindMessageKey, notificationTarget, type NotificationRow } from "@/frontend/pages/notifications/types"

/**
 * One event, as the popover and the page both show it: what happened, how
 * long ago, and whether it has been read. Opening it marks it read and goes
 * to the thing it is about — a row with no page of its own (a claim decision,
 * a new member) is still read by being clicked.
 */
export function NotificationItem({
    row,
    onNavigate,
}: {
    row: NotificationRow
    /** Lets the popover close itself as the reader leaves for the page */
    onNavigate?: () => void
}) {
    const t = useTranslations("App.notifications")
    const kinds = useTranslations("App.notifications.kinds")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })
    const router = useRouter()
    const { markRead } = useNotificationMutations()

    // The kind is a database column, so the message key is only known at
    // runtime while the typed signature takes literal ones. The writer of the
    // event is what makes a message and its params agree
    const line = kinds as unknown as (key: string, values: Record<string, string | number>) => string

    const target = notificationTarget(row.entityType, row.entityId)
    const unread = row.readAt === null

    const open = () => {
        if (unread) markRead.mutate({ ids: [row.id] })

        onNavigate?.()

        if (target) router.push(target.link)
    }

    return (
        <button
            type="button"
            onClick={open}
            className={cn(
                "hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2",
                unread && "bg-primary/[0.04]",
            )}
        >
            <span className="flex size-4 shrink-0 items-center justify-center pt-1">
                {unread && (
                    <>
                        <span className="bg-primary size-2 rounded-full" />
                        <span className="sr-only">{t("unread")}</span>
                    </>
                )}
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-sm", unread && "font-medium")}>
                    {line(kindMessageKey(row.kind), icuValues(row.params))}
                </span>
                <span className="text-muted-foreground text-xs">
                    {f.relativeTime(row.createdAt, now)}
                </span>
            </span>

            {target && <IconChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" stroke={1.5} />}
        </button>
    )
}
