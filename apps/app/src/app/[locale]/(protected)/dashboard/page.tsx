import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { latestLoadsInput, yearInput } from "@/frontend/pages/dashboard/types"
import { CardError, DashboardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { DashboardView } from "@/frontend/pages/dashboard/views/dashboard-view"

export async function generateMetadata() {
    const t = await getTranslations("App.dashboard")

    return { title: t("title") }
}

/**
 * Where signing in lands. Everything the board reads is fetched here, on one
 * request, with the very builders the client cards query with — so each card
 * hydrates into its prefetched query instead of asking again, and the page
 * streams card by card behind the boundaries the view puts around them.
 *
 * The tenancy is not read here: every one of these procedures is a
 * `tenantProcedure`, so the organization comes from the session on the server
 * side of each call rather than from anything this page could hand down.
 */
export default async function Dashboard() {
    const t = await getTranslations("App.dashboard")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.analytics.pipeline.queryOptions())
    prefetch(trpc.map.overview.queryOptions())
    prefetch(trpc.analytics.monthly.queryOptions(yearInput()))
    prefetch(trpc.analytics.money.queryOptions(yearInput()))
    prefetch(trpc.analytics.loads.queryOptions(yearInput()))
    prefetch(trpc.movements.list.queryOptions(latestLoadsInput("orders")))
    prefetch(trpc.movements.list.queryOptions(latestLoadsInput("trips")))
    prefetch(trpc.movements.stats.queryOptions({ scope: "orders" }))
    prefetch(trpc.movements.stats.queryOptions({ scope: "trips" }))

    // The queue's connection count is warmed here too, but it rides its own
    // client query: a bad minute there loses that one row, not the card
    prefetch(trpc.partners.stats.queryOptions())

    return (
        // The protected layout only pads horizontally; the vertical room and
        // the viewport lock are this page's job, as on the list pages
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<CardError message={t("error")} />}>
                    <Suspense fallback={<DashboardSkeleton />}>
                        <DashboardView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
