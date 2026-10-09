import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { RentalDetailSkeleton } from "@/frontend/pages/rentals/views/detail-fallbacks"
import { RentalDetailView } from "@/frontend/pages/rentals/views/rental-detail-view"

export async function generateMetadata() {
    const t = await getTranslations("App.rentals.detail")

    return { title: t("meta") }
}

/**
 * One rental, read by whoever is on it: the owner sees the whole, the client
 * every truck and the diary but no buy prices, a provider only its own
 * trucks. A static segment beside `orders/[section]`, like a load's page.
 */
export default async function RentalPage({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const t = await getTranslations("App.rentals.detail")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.rentals.get.queryOptions({ id: orderId }))

    return (
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
                    <Suspense fallback={<RentalDetailSkeleton />}>
                        <RentalDetailView rentalId={orderId} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
