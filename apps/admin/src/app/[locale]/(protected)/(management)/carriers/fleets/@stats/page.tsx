import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { VehicleStatsView } from "@/frontend/pages/partners/views/partners-stats-view"
import { currentKind } from "@/frontend/pages/partners/types"

function StatsSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
        </div>
    )
}

export default async function Stats({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams

    // Trucks, trailers and links share this page; the kind is a filter
    const kind = currentKind((key) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.vehicleStats.queryOptions({ kind }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<StatsSkeleton />}>
                <Suspense fallback={<StatsSkeleton />}>
                    <VehicleStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
