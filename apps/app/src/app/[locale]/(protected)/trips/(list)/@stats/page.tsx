import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { TripsStatsView } from "@/frontend/pages/trips/views/trips-stats-view"

export default function Stats() {
    prefetch(trpc.trips.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <TripsStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
