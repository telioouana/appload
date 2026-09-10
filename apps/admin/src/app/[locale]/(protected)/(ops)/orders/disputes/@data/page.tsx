import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { disputesListInput } from "@/frontend/pages/disputes/types"
import { DisputesDataView } from "@/frontend/pages/disputes/views/disputes-data-view"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("Admin.disputes.data")

    // Same input builder the client view uses, so the prefetch hydrates its query
    const input = disputesListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.disputes.list.queryOptions(input))
    prefetch(trpc.disputes.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <DisputesDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
