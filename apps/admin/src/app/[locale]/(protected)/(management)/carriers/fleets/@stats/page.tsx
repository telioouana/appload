import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { VehicleStatsView } from "@/frontend/pages/partners/views/partners-stats-view"
import { currentKind, currentOwner } from "@/frontend/pages/partners/types"

export default async function Stats({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams

    const get = (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    }

    // Trucks, trailers and links share this page; the kind is a filter, and
    // so is whose fleet is listed — the tiles follow both
    const kind = currentKind(get)
    const owner = currentOwner(get)

    prefetch(trpc.partners.vehicleStats.queryOptions({ kind, owner }))

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
