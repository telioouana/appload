import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError } from "@/frontend/components/list-fallbacks"
import { analyticsInput } from "@/frontend/pages/analytics/types"
import { AnalyticsSkeleton } from "@/frontend/pages/analytics/views/analytics-fallbacks"
import { AnalyticsView } from "@/frontend/pages/analytics/views/analytics-view"

export async function generateMetadata() {
    const t = await getTranslations("App.analytics")

    return { title: t("title") }
}

export default async function AnalyticsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.analytics")

    // The same input builder the client sections use, so every card on the
    // first paint hydrates from what was fetched here instead of asking again
    const input = analyticsInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.analytics.pipeline.queryOptions())
    prefetch(trpc.analytics.monthly.queryOptions({ year: input.year }))
    prefetch(trpc.analytics.money.queryOptions({ year: input.year }))
    prefetch(trpc.analytics.kpis.queryOptions(input))
    // The ranking opens on its busiest partners; the card starts on the same
    // order, which is what makes this a hydration rather than a second fetch
    prefetch(trpc.analytics.partners.queryOptions({ ...input, sort: "orders" }))

    return (
        // The header and the bands are one client view here, so the page owns
        // the frame the list pages get from their shell
        <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<ListError message={t("error")} />}>
                    <Suspense fallback={<AnalyticsSkeleton />}>
                        <AnalyticsView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
