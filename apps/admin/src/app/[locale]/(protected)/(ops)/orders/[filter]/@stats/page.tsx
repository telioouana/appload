import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { cashflowInput, isSection } from "@/frontend/pages/orders/types"
import { OrdersStatsView } from "@/frontend/pages/orders/views/orders-stats-view"
import { StripSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"

export default async function Stats({
    params,
    searchParams,
}: {
    params: Promise<{ filter: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { filter } = await params

    if (!isSection(filter)) notFound()

    const search = await searchParams

    // The strip covers the whole year on every section page; the same
    // parser the client uses, so the prefetch hydrates its query
    prefetch(trpc.orders.cashflow.queryOptions(cashflowInput((key) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<StripSkeleton />}>
                <Suspense fallback={<StripSkeleton />}>
                    <OrdersStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
