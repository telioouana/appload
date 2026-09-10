import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { MapView } from "@/frontend/pages/map/views/map-view"

export async function generateMetadata() {
    const t = await getTranslations("App.map")

    return { title: t("title") }
}

export default async function MapPage() {
    const t = await getTranslations("App.map")

    // The overview takes no input, so the server-fetched list hydrates
    // straight into the client query instead of being refetched
    prefetch(trpc.map.overview.queryOptions())

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden py-4">
            <HydrateClient>
                <ErrorBoundary fallback={<ListError message={t("error")} />}>
                    <Suspense fallback={<ListSkeleton />}>
                        <MapView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
