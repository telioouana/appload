import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { currentYear, isSection, ordersListInput } from "@/frontend/pages/orders/types"
import { OrdersDataView } from "@/frontend/pages/orders/views/orders-data-view"
import { ListError, ListSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"

export default async function Data({
    params,
    searchParams,
}: {
    params: Promise<{ filter: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { filter } = await params

    if (!isSection(filter)) notFound()

    const search = await searchParams
    const t = await getTranslations("Admin.orders.list.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = ordersListInput(filter, (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.orders.list.queryOptions(input))
    prefetch(trpc.orders.stats.queryOptions({ year: input.year ?? currentYear() }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <OrdersDataView section={filter} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
