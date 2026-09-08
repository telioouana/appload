import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { CardError } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { overviewInput } from "@/frontend/pages/metrics/types"
import { MetricsSkeleton } from "@/frontend/pages/metrics/views/metrics-fallbacks"
import { MetricsView } from "@/frontend/pages/metrics/views/metrics-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.metrics")

    return { title: t("title") }
}

/**
 * How the business has done since March 2022. One read of Claire's
 * spreadsheet feeds the whole page, so it is fetched here, on this request,
 * with the very builder every card queries with — each card then hydrates
 * into the prefetched query instead of asking again.
 *
 * `year` scopes nothing on the server: it picks which months the table at the
 * foot lists, and the view reads it from the URL itself. The params are still
 * awaited, so this page renders at request time alongside the client that
 * reads them.
 */
export default async function Metrics({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const t = await getTranslations("Admin.metrics")

    await searchParams

    prefetch(trpc.metrics.overview.queryOptions(overviewInput()))

    return (
        // The protected layout only pads horizontally; the vertical room and
        // the viewport lock are this page's job, as on the dashboard
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<CardError message={t("error")} />}>
                    <Suspense fallback={<MetricsSkeleton />}>
                        <MetricsView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
