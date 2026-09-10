import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { PartnersStatsView } from "@/frontend/pages/partners/views/partners-stats-view"

export default function Stats() {
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.partners.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <PartnersStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
