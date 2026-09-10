import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TilesSkeleton } from "@/frontend/components/list-fallbacks"
import { OrdersStatsView } from "@/frontend/pages/orders/views/orders-stats-view"
import { ORDER_SECTIONS, type OrderSection } from "@/frontend/pages/orders/types"

export default async function Stats({ params }: { params: Promise<{ section: string }> }) {
    const { section } = await params

    if (!(ORDER_SECTIONS as readonly string[]).includes(section)) notFound()

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.orders.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <OrdersStatsView section={section as OrderSection} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
