import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { DetailSkeleton } from "@/frontend/pages/orders/views/detail-fallbacks"
import { OrderDetailView } from "@/frontend/pages/orders/views/order-detail-view"

// The URL segment is the order's own reference (APPL021.26), so the tab can
// be named without waiting on the query the page prefetches
export async function generateMetadata({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const t = await getTranslations("App.orders.detail")

    return { title: t("meta", { orderId: decodeURIComponent(orderId) }) }
}

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const decoded = decodeURIComponent(orderId)
    const t = await getTranslations("App.orders.detail")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.orders.get.queryOptions({ orderId: decoded }))
    prefetch(trpc.orders.history.queryOptions({ orderId: decoded }))
    prefetch(trpc.orders.transitionOptions.queryOptions({ orderId: decoded }))

    return (
        // Full bleed, like the list pages: the app inset is the frame and the
        // gutter comes from the sections themselves. From lg up the page
        // itself does not scroll — its two columns do
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
                    <Suspense fallback={<DetailSkeleton />}>
                        <OrderDetailView orderId={decoded} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
