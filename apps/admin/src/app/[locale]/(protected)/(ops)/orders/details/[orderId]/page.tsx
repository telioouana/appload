import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { getTranslations } from "@workspace/i18n/server";

import { Alert, AlertDescription } from "@workspace/ui/components/alert";

import { HydrateClient, prefetch, trpc } from "@/backend/api/server";
import { DetailsSkeleton } from "@/frontend/pages/order/views/details-fallbacks";
import { OrderDetailsView } from "@/frontend/pages/order/views/order-details-view";

// The URL segment is the order's own reference (order.orderId), so the tab
// can be named without waiting on the query the page prefetches
export async function generateMetadata({
    params,
}: {
    params: Promise<{ orderId: string }>
}) {
    const { orderId } = await params;
    const t = await getTranslations("Admin.orders.detailPage");

    return { title: t("metaTitle", { reference: decodeURIComponent(orderId) }) };
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
