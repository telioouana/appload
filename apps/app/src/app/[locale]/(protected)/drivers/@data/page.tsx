import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/components/list-fallbacks"
import { DriversDataView } from "@/frontend/pages/drivers/views/drivers-data-view"
import { driversListInput } from "@/frontend/pages/drivers/types"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.drivers.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = driversListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.drivers.list.queryOptions(input))
    prefetch(trpc.drivers.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <DriversDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
