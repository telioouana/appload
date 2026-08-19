import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { Card, CardContent } from "@workspace/ui/components/card"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { vehiclesListInput } from "@/frontend/pages/partners/types"
import { VehiclesDataView } from "@/frontend/pages/partners/views/vehicles-data-view"

function DataSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-xl" />
            ))}
        </div>
    )
}

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("Admin.partners.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = vehiclesListInput((key) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.vehicles.infiniteQueryOptions(
        input,
        { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ))

    return (
        <HydrateClient>
            <ErrorBoundary
                fallback={
                    <Card className="min-h-fit">
                        <CardContent className="py-10">
                            <p className="text-destructive text-center text-sm">{t("error")}</p>
                        </CardContent>
                    </Card>
                }
            >
                <Suspense fallback={<DataSkeleton />}>
                    <VehiclesDataView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
