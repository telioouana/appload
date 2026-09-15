import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { DriverStatsView } from "@/frontend/pages/partners/views/partners-stats-view"
import { currentOwner } from "@/frontend/pages/partners/types"

export default async function Stats({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams

    // Whose fleet is listed is a filter; the tiles follow it
    const owner = currentOwner((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.driverStats.queryOptions({ owner }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <DriverStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
