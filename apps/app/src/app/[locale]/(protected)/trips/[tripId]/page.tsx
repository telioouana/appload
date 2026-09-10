import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { TripDetailSkeleton } from "@/frontend/pages/trips/views/detail-fallbacks"
import { TripDetailView } from "@/frontend/pages/trips/views/trip-detail-view"

// The URL segment is the trip's row id, not its reference, so the tab is
// named generically rather than waiting on the query the page prefetches
export async function generateMetadata() {
    const t = await getTranslations("App.trips.detail")

    return { title: t("meta") }
}

export default async function TripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
    const { tripId } = await params
    const decoded = decodeURIComponent(tripId)
    const t = await getTranslations("App.trips.detail")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.trips.get.queryOptions({ id: decoded }))
    prefetch(trpc.trips.trail.queryOptions({ id: decoded }))

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
                    <Suspense fallback={<TripDetailSkeleton />}>
                        <TripDetailView tripId={decoded} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
