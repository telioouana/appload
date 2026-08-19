import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { getTranslations } from "@workspace/i18n/server";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Card, CardContent } from "@workspace/ui/components/card";

import { HydrateClient, prefetch, trpc } from "@/backend/api/server";
import { FILTER, ordersListInput } from "@/frontend/pages/orders/types";
import { OrdersDataView } from "@/frontend/pages/orders/views/orders-data-view";

function DataSkeleton() {
    return (
        <Card className="min-h-fit">
            <CardContent className="flex flex-col gap-4">
                <Skeleton className="h-4 w-24" />
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

export default async function Data({
    params,
    searchParams,
}: {
    params: Promise<{ filter: FILTER }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { filter } = await params
    const search = await searchParams
    const t = await getTranslations("Admin.orders.data")

    // Same input builder as the client view, so the server-fetched first page
    // hydrates straight into the client query instead of refetching
    prefetch(trpc.orders.list.infiniteQueryOptions(
        ordersListInput(filter, (key) => {
            const value = search[key]
            return typeof value === "string" ? value : null
        }),
        {
            getNextPageParam: (lastPage) => lastPage.nextCursor,
        },
    ))

    return (
        <HydrateClient>
            <ErrorBoundary
                fallback={
                    <Card className="min-h-fit">
                        <CardContent className="py-10">
                            <p className="text-destructive text-sm text-center">{t("error")}</p>
                        </CardContent>
                    </Card>
                }
            >
                <Suspense fallback={<DataSkeleton />}>
                    <OrdersDataView filter={filter} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
