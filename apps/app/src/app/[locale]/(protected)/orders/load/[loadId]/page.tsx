import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { LoadDetailSkeleton } from "@/frontend/pages/movements/views/detail-fallbacks"
import { MovementDetailView } from "@/frontend/pages/movements/views/movement-detail-view"

export async function generateMetadata() {
    const t = await getTranslations("App.loads.detail")

    return { title: t("meta") }
}

/**
 * One load, whichever shape it is and whoever is reading it: the owner's
 * trip or order, the work a partner offered, the load moved for a client.
 * The address is the movement's own id, so a trip handed to a partner — or
 * an order taken back in-house — keeps it, and every link to it still works.
 */
export default async function LoadPage({ params }: { params: Promise<{ loadId: string }> }) {
    const { loadId } = await params
    const t = await getTranslations("App.loads.detail")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.get.queryOptions({ id: loadId }))

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
                    <Suspense fallback={<LoadDetailSkeleton />}>
                        <MovementDetailView loadId={loadId} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
