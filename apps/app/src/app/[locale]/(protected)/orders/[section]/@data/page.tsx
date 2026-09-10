import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/components/list-fallbacks"
import { OrdersDataView } from "@/frontend/pages/orders/views/orders-data-view"
import { ORDER_SECTIONS, ordersListInput, type OrderSection } from "@/frontend/pages/orders/types"

export default async function Data({
    params,
    searchParams,
}: {
    params: Promise<{ section: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { section } = await params

    if (!(ORDER_SECTIONS as readonly string[]).includes(section)) notFound()

    const search = await searchParams
    const t = await getTranslations("App.orders.data")

    // The same input builder the client view uses, so the server-fetched
    // first page hydrates straight into the client query
    const input = ordersListInput(section as OrderSection, (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.orders.list.queryOptions(input))
    prefetch(trpc.orders.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <OrdersDataView section={section as OrderSection} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
