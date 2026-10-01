import "server-only"

import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HeaderSkeleton, ListError, ListSkeleton, TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { contractsListInput } from "@/frontend/pages/contracts/types"
import { ContractsDataView } from "@/frontend/pages/contracts/views/contracts-data-view"
import { ContractsHeaderView } from "@/frontend/pages/contracts/views/contracts-header-view"
import { ContractsStatsView } from "@/frontend/pages/contracts/views/contracts-stats-view"

/**
 * The three slots of the multi-trip orders list — the "Várias viagens"
 * section of Pedidos. The movements slots hand over to these when the
 * section is `multi`; the views read `?tab=own|partners` the same way the
 * rest of Pedidos does.
 */

type SearchParams = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const getterOf = (search: Record<string, string | string[] | undefined>) => (key: string) => {
    const value = search[key]
    return typeof value === "string" ? value : null
}

export function ContractsHeaderSlot() {
    // The action is gated on the reader's role, and the two tab pills each
    // carry their own side's count — so both tabs' stats are read here
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.stats.queryOptions({ tab: "own" }))
    prefetch(trpc.contracts.stats.queryOptions({ tab: "partners" }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <ContractsHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}

export async function ContractsStatsSlot({ searchParams }: SearchParams) {
    const { tab } = contractsListInput(getterOf(await searchParams))

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

export async function ContractsDataSlot({ searchParams }: SearchParams) {
    const t = await getTranslations("App.contracts")
    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = contractsListInput(getterOf(await searchParams))

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.list.queryOptions(input))
    prefetch(trpc.contracts.stats.queryOptions({ tab: input.tab }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <ContractsDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
