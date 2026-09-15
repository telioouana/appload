import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { PartnersStatsView } from "@/frontend/pages/partners/views/partners-stats-view"
import { kindFromSlug } from "@/frontend/pages/partners/types"

export default async function Stats({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const list = kindFromSlug(kind)

    if (!list) notFound()

    prefetch(trpc.partners.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <PartnersStatsView kind={list} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
