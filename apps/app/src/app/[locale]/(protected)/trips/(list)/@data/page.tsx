import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/components/list-fallbacks"
import { tripsListInput } from "@/frontend/pages/trips/types"
import { TripsDataView } from "@/frontend/pages/trips/views/trips-data-view"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.trips")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = tripsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.trips.list.queryOptions(input))
    prefetch(trpc.trips.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <TripsDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
