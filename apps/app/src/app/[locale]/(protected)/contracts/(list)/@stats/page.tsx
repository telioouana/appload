import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { contractsListInput } from "@/frontend/pages/contracts/types"
import { ContractsStatsView } from "@/frontend/pages/contracts/views/contracts-stats-view"

export default async function Stats({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams

    // The tiles count the tab on screen, read the way the client view reads it
    const { tab } = contractsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.stats.queryOptions({ tab }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <ContractsStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
