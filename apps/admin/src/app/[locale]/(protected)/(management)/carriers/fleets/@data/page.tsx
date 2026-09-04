import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"
import { vehiclesListInput } from "@/frontend/pages/partners/types"
import { VehiclesDataView } from "@/frontend/pages/partners/views/vehicles-data-view"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("Admin.partners.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = vehiclesListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.vehicles.queryOptions(input))
    prefetch(trpc.partners.vehicleStats.queryOptions({ kind: input.kind }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <VehiclesDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
