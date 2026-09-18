import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { quotesListInput } from "@/frontend/pages/quotes/types"
import { QuotesDataView } from "@/frontend/pages/quotes/views/quotes-data-view"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.quotes")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = quotesListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.quotes.list.queryOptions(input))
    prefetch(trpc.quotes.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <QuotesDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
