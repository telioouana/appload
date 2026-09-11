import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { FleetStatsView } from "@/frontend/pages/fleet/views/fleet-stats-view"
import { kindFromSlug } from "@/frontend/pages/fleet/types"

export default async function Stats({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const vehicle = kindFromSlug(kind)

    if (!vehicle) notFound()

    prefetch(trpc.fleet.vehicles.stats.queryOptions({ kind: vehicle }))
    // Whether the tiles include the verification ones (use-verified-fleet.ts)
    prefetch(trpc.me.session.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <FleetStatsView kind={vehicle} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
