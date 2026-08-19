import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { getTranslations } from "@workspace/i18n/server";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Card, CardContent } from "@workspace/ui/components/card";

import { HydrateClient, prefetch, trpc } from "@/backend/api/server";
import { OrderDetailsView } from "@/frontend/pages/order/views/order-details-view";

// Mirrors the real page grid so the layout doesn't jump on load
function DetailsSkeleton() {
    return (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
            <div className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-48 w-full rounded-2xl" />
                <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
            <div className="flex flex-col gap-3">
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
        </div>
    )
}

export default async function OrderDetailPage({
    params,
}: {
    params: Promise<{ orderId: string }>
}) {
    const { orderId } = await params
    const decoded = decodeURIComponent(orderId)
    const t = await getTranslations("Admin.orders.detailPage")

    prefetch(trpc.order.get.queryOptions({ orderId: decoded }))

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 container-snap max-w-5xl mx-auto">
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
                    <Suspense fallback={<DetailsSkeleton />}>
                        <OrderDetailsView orderId={decoded} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
