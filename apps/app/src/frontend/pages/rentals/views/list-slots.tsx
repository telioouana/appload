import "server-only"

import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HeaderSkeleton, ListError, ListSkeleton, TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { rentalsListInput } from "@/frontend/pages/rentals/types"
import { RentalsDataView } from "@/frontend/pages/rentals/views/rentals-data-view"
import { RentalsHeaderView } from "@/frontend/pages/rentals/views/rentals-header-view"
import { RentalsStatsView } from "@/frontend/pages/rentals/views/rentals-stats-view"

/**
 * The three slots of the rentals list — the "Alugueres" section of Pedidos.
 * The movements slots hand over to these when the section is `rental`; the
 * views read `?tab=own|partners` the same way the rest of Pedidos does.
 */

type SearchParams = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const getterOf = (search: Record<string, string | string[] | undefined>) => (key: string) => {
    const value = search[key]
    return typeof value === "string" ? value : null
}

export function RentalsHeaderSlot() {
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.rentals.stats.queryOptions({ tab: "own" }))
    prefetch(trpc.rentals.stats.queryOptions({ tab: "partners" }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <RentalsHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}

export async function RentalsStatsSlot({ searchParams }: SearchParams) {
    const { tab } = rentalsListInput(getterOf(await searchParams))

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.rentals.stats.queryOptions({ tab }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <RentalsStatsView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}

export async function RentalsDataSlot({ searchParams }: SearchParams) {
    const t = await getTranslations("App.rentals")
    const input = rentalsListInput(getterOf(await searchParams))

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.rentals.list.queryOptions(input))
    prefetch(trpc.rentals.stats.queryOptions({ tab: input.tab }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <RentalsDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
