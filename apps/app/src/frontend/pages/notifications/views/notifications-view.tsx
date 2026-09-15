"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"
import { IconBellOff, IconChecks } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { NotificationFilters } from "@/frontend/pages/notifications/components/notification-filters"
import { NotificationItem } from "@/frontend/pages/notifications/components/notification-item"
import { useNotificationMutations } from "@/frontend/pages/notifications/hooks/use-notification-mutations"
import { isFilteredNotifications, notificationsListInput, PAGE_SIZES } from "@/frontend/pages/notifications/types"

/**
 * The notification centre in full: everything the popover only shows the top
 * of, with the two filters that make a long history readable and one button
 * that clears it.
 *
 * The page does not poll. It is opened to be read, and every row on it is
 * already on screen — the badge in the header is what watches for new ones.
 */
export function NotificationsView() {
    const t = useTranslations("App.notifications")
    const trpc = useTRPC()

    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const input = notificationsListInput(get)
    const { data } = useSuspenseQuery(trpc.notifications.list.queryOptions(input))
    const isRefreshing = useIsFetching({ queryKey: trpc.notifications.list.pathKey() }) > 0

    const { markAllRead } = useNotificationMutations()

    const filtered = isFilteredNotifications(get)

    return (
        <>
            <PageHeader
                title={t("title")}
                count={data.total}
                description={t("description")}
                below={<NotificationFilters />}
                actions={
                    <Button variant="outline" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
                        <IconChecks className="size-4" stroke={1.5} />
                        {t("actions.mark-all")}
                    </Button>
                }
            />

            <ListCard>
                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <Scroller>
                        {data.items.length === 0 ? (
                            <Empty className="border-none py-16">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <IconBellOff stroke={1.5} />
                                    </EmptyMedia>
                                    <EmptyTitle>{filtered ? t("data.no-results.title") : t("data.empty.title")}</EmptyTitle>
                                    <EmptyDescription>
                                        {filtered ? t("data.no-results.description") : t("data.empty.description")}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <div className="divide-y">
                                {data.items.map((row) => <NotificationItem key={row.id} row={row} />)}
                            </div>
                        )}
                    </Scroller>
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>
        </>
    )
}
