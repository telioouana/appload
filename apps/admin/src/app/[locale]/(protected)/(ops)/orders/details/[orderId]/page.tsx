import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { getTranslations } from "@workspace/i18n/server";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";

import { HydrateClient, prefetch, trpc } from "@/backend/api/server";
import { OrderDetailsView } from "@/frontend/pages/order/views/order-details-view";

// Mirrors the real page — header, trip strip, then the main column and its
// rail — so nothing jumps when the order arrives
function DetailsSkeleton() {
    return (
        <>
            <div className="flex flex-col gap-2 px-2">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
            </div>

            <div className="px-2">
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>

            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,700px)_minmax(320px,1fr)]">
                <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                    <Skeleton className="h-56 w-full shrink-0 rounded-2xl" />
                    <Skeleton className="h-80 w-full shrink-0 rounded-2xl" />
                    <Skeleton className="h-44 w-full shrink-0 rounded-2xl" />
                </div>
                <Skeleton className="h-96 w-full rounded-2xl lg:h-full" />
            </div>
        </>
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
        // Full bleed, like the list pages: the app inset is the frame, and
        // the 8px gutter comes from the sections themselves. From lg up the
        // page itself does not scroll — the left column does, so the map on
        // the right stays whole no matter how long the order is
        <div className="container-snap flex h-full min-h-0 flex-col gap-5 overflow-y-auto pt-5 pb-2 lg:overflow-hidden">
            <HydrateClient>
                <ErrorBoundary
                    fallback={
                        <div className="px-2">
                            <Alert variant="destructive">
                                <AlertDescription>{t("error")}</AlertDescription>
                            </Alert>
                        </div>
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
