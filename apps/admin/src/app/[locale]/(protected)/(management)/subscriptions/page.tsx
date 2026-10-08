import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { subscriptionsListInput } from "@/frontend/pages/subscriptions/types"
import { SubscriptionsDataView } from "@/frontend/pages/subscriptions/views/subscriptions-data-view"
import { SubscriptionsHeaderView } from "@/frontend/pages/subscriptions/views/subscriptions-header-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.subscriptions")

    return { title: t("title") }
}

export default async function SubscriptionsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("Admin.subscriptions.data")

    // Same input builder the client views use, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = subscriptionsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.subscriptions.list.queryOptions(input))

    return (
        <HydrateClient>
            <ListPageShell
                header={<SubscriptionsHeaderView />}
                stats={null}
                data={
                    <ErrorBoundary fallback={<ListError message={t("error")} />}>
                        <Suspense fallback={<ListSkeleton />}>
                            <SubscriptionsDataView />
                        </Suspense>
                    </ErrorBoundary>
                }
            />
        </HydrateClient>
    )
}
