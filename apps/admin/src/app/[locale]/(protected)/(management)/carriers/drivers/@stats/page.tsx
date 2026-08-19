import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { DriverStatsView } from "@/frontend/pages/partners/views/partners-stats-view"

function StatsSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
        </div>
    )
}

export default async function Stats() {
    prefetch(trpc.partners.driverStats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<StatsSkeleton />}>
                <Suspense fallback={<StatsSkeleton />}>
                    <DriverStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
