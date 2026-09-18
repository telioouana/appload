import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { DisputesStatsView } from "@/frontend/pages/disputes/views/disputes-stats-view"
import { StripSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

export default function Stats() {
    prefetch(trpc.disputes.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<StripSkeleton />}>
                <Suspense fallback={<StripSkeleton />}>
                    <DisputesStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
