import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/components/list-fallbacks"
import { VehiclesDataView } from "@/frontend/pages/fleet/views/vehicles-data-view"
import { kindFromSlug, vehiclesListInput } from "@/frontend/pages/fleet/types"

export default async function Data({
    params,
    searchParams,
}: {
    params: Promise<{ kind: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { kind } = await params
    const vehicle = kindFromSlug(kind)

    if (!vehicle) notFound()

    const search = await searchParams
    const t = await getTranslations("App.fleet.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = vehiclesListInput(vehicle, (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.fleet.vehicles.list.queryOptions(input))
    prefetch(trpc.fleet.vehicles.stats.queryOptions({ kind: vehicle }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <VehiclesDataView kind={vehicle} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
