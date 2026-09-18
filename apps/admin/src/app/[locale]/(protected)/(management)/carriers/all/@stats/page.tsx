import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { OrganizationStatsView } from "@/frontend/pages/partners/views/partners-stats-view"

export default async function Stats() {
    prefetch(trpc.partners.organizationStats.queryOptions({ type: "carrier" }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <OrganizationStatsView type="carrier" />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
