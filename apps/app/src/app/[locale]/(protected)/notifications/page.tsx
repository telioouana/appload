import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError } from "@/frontend/components/list-fallbacks"
import { notificationsListInput } from "@/frontend/pages/notifications/types"
import { NotificationsSkeleton } from "@/frontend/pages/notifications/views/notifications-fallbacks"
import { NotificationsView } from "@/frontend/pages/notifications/views/notifications-view"

export async function generateMetadata() {
    const t = await getTranslations("App.notifications")

    return { title: t("title") }
}

export default async function NotificationsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.notifications")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = notificationsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.notifications.list.queryOptions(input))

    return (
        // The header and the card are one client view here, so the page owns
        // the frame the list pages get from their shell
        <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                    <Suspense fallback={<NotificationsSkeleton />}>
                        <NotificationsView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
