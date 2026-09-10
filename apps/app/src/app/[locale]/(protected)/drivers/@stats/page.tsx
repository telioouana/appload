import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@/frontend/components/list-fallbacks"
import { DriversStatsView } from "@/frontend/pages/drivers/views/drivers-stats-view"

export default function Stats() {
    prefetch(trpc.drivers.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <DriversStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
