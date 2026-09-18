import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { dashboardYear, latestInput, moneyInput, tilesStatsInput, yearInput } from "@/frontend/pages/dashboard/types"
import { CardError, DashboardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { DashboardView } from "@/frontend/pages/dashboard/views/dashboard-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.dashboard")

    return { title: t("title") }
}

/**
 * Where signing in lands. Everything the board reads is fetched here, on one
 * request, with the very builders the client sections query with — so each
 * card hydrates into its prefetched query instead of asking again, and the
 * page streams card by card behind the boundaries the view puts around them.
 *
 * `year` is the only param the server has an opinion about: it scopes the
 * chart and the money card. The tiles, the queue and the map are always the
 * current year, so they take no part in it.
 */
export default async function Dashboard({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const t = await getTranslations("Admin.dashboard")
    const search = await searchParams

    // The same parser the view reads the URL with; an absent (or unusable)
    // year stays undefined, which hashes like the key not being there at all
    const year = dashboardYear((key) => {
        const value = search[key]
        // A repeated param arrives as an array; take the first entry, as
        // `URLSearchParams.get` does on the client — otherwise `?year=&year=`
        // would prefetch one year and hydrate into another
        return (Array.isArray(value) ? value[0] : value) ?? null
    })

    prefetch(trpc.orders.stats.queryOptions(tilesStatsInput()))
    prefetch(trpc.map.overview.queryOptions())
    prefetch(trpc.dashboard.monthly.queryOptions(yearInput(year)))
    prefetch(trpc.orders.cashflow.queryOptions(moneyInput(year)))
    prefetch(trpc.orders.list.queryOptions(latestInput()))

    // The queue's three side counts: warmed here, but each one rides its own
    // client query, so a role without the permission simply loses that row
    prefetch(trpc.chats.unread.queryOptions())
    prefetch(trpc.disputes.attention.queryOptions())
    prefetch(trpc.partners.reviewQueue.queryOptions())

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
