import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { TripsHeaderView } from "@/frontend/pages/trips/views/trips-header-view"

export default function Header() {
    // The count is the same stats the tiles show, and the new-trip sheet
    // needs the session's allowance before it can offer to start anything
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.trips.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <TripsHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
