import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { QuotesStatsView } from "@/frontend/pages/quotes/views/quotes-stats-view"

export default function Stats() {
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.quotes.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <QuotesStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
