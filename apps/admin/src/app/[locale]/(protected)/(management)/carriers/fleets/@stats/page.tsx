import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"
import { VehicleStatsView } from "@/frontend/pages/partners/views/partners-stats-view"
import { currentKind } from "@/frontend/pages/partners/types"

export default async function Stats({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams

    // Trucks, trailers and links share this page; the kind is a filter
    const kind = currentKind((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.vehicleStats.queryOptions({ kind }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <VehicleStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
