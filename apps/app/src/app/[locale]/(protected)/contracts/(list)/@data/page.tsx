import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { contractsListInput } from "@/frontend/pages/contracts/types"
import { ContractsDataView } from "@/frontend/pages/contracts/views/contracts-data-view"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.contracts")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = contractsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

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
