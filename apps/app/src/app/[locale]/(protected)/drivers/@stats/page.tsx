import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { DriversStatsView } from "@/frontend/pages/drivers/views/drivers-stats-view"

export default function Stats() {
    prefetch(trpc.drivers.stats.queryOptions())
    // Whether the tiles include the verification ones (use-verified-fleet.ts)
    prefetch(trpc.me.session.queryOptions())

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
