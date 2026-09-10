"use client"

import { IconBellOff, IconChecks } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useTRPC } from "@/backend/api/client"
import { Link } from "@/i18n/navigation"
import { NotificationItem } from "@/frontend/pages/notifications/components/notification-item"
import { useNotificationMutations } from "@/frontend/pages/notifications/hooks/use-notification-mutations"
import { POPOVER_PAGE_SIZE, POPOVER_POLL_MS } from "@/frontend/pages/notifications/types"

/**
 * The top of the inbox, read and unread alike: what happened is the point,
 * and hiding what was already seen would leave the panel empty most of the
 * time.
 *
 * Radix mounts this only while the popover is open, which is what scopes the
 * ten-second poll to the moment somebody is actually watching it; the badge's
 * slower one carries on either way.
 */
export function NotificationPopover({ onNavigate }: { onNavigate: () => void }) {
    const t = useTranslations("App.notifications")
    const trpc = useTRPC()

    const { data, isPending } = useQuery(trpc.notifications.list.queryOptions(
        { page: 1, pageSize: POPOVER_PAGE_SIZE },
        { refetchInterval: POPOVER_POLL_MS },
    ))

    const { markAllRead } = useNotificationMutations()

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <span className="text-sm font-semibold">{t("title")}</span>

                <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground h-7 px-2 text-xs"
                    disabled={markAllRead.isPending}
                    onClick={() => markAllRead.mutate()}
                >
                    <IconChecks className="size-4" stroke={1.5} />
                    {t("actions.mark-all-short")}
                </Button>
            </div>

            <div className="container-snap max-h-96 overflow-y-auto">
                {isPending ? (
                    <div className="flex flex-col gap-3 p-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <Skeleton key={index} className="h-10 w-full rounded-xl" />
                        ))}
                    </div>
                ) : data && data.items.length > 0 ? (
                    <div className="divide-y">
                        {data.items.map((row) => (
                            <NotificationItem key={row.id} row={row} onNavigate={onNavigate} />
                        ))}
                    </div>
                ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
                        <IconBellOff className="size-6" stroke={1.5} />
                        {t("popover.empty")}
                    </div>
                )}
            </div>

            <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full" asChild onClick={onNavigate}>
                    <Link href="/notifications">{t("popover.view-all")}</Link>
                </Button>
            </div>
        </div>
    )
}
