import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"
import { DriverStatsView } from "@/frontend/pages/partners/views/partners-stats-view"

export default async function Stats() {
    prefetch(trpc.partners.driverStats.queryOptions())

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
