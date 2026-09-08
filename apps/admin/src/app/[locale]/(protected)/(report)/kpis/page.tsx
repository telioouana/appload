import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListPageShell } from "@/components/list/list-page-shell"
import { listInput, statsInput } from "@/frontend/pages/kpis/types"
import { KpisDataView } from "@/frontend/pages/kpis/views/kpis-data-view"
import { KpisHeaderSkeleton } from "@/frontend/pages/kpis/views/kpis-fallbacks"
import { KpisHeaderView } from "@/frontend/pages/kpis/views/kpis-header-view"
import { KpisStatsView } from "@/frontend/pages/kpis/views/kpis-stats-view"
import { ListError, ListSkeleton, TilesSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"

export async function generateMetadata() {
    const t = await getTranslations("Admin.kpis")

    return { title: t("title") }
}

/**
 * Every shipper — or carrier — that moved something in the period, ranked by
 * whichever column the toolbar points at. It is the partner directories'
 * frame and furniture, because it is the same kind of page: a header with the
 * count and the search, tiles that measure the whole period, and one card
 * that owns the scrolling.
 *
 * The URL is the whole state — the period, the side of the trade, the search
 * and the paging — so everything the page shows is fetched here, on this
 * request, with the very builders the views query with; each band then
 * hydrates into its prefetched query instead of asking again, and the page
 * streams band by band behind its own boundary.
 *
 * A row leads to `/kpis/[party]`, a route of its own rather than a parameter
 * on this one, which is what makes Back land back on this list exactly as it
 * was left.
 *
 * Money is USD everywhere on this page, converted per trip at its own
 * loading-day rate; the procedure does that before anything is divided.
 */
export default async function KPIs({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const t = await getTranslations("Admin.kpis")
    const search = await searchParams

    // The same reader the client parsers get from `useSearchParams`. A
    // repeated param arrives as an array; take the first entry, as
    // `URLSearchParams.get` does on the client — otherwise `?page=1&page=4`
    // would prefetch one page and hydrate into another
    const get = (key: string) => {
        const value = search[key]
        return (Array.isArray(value) ? value[0] : value) ?? null
    }

    prefetch(trpc.kpis.stats.queryOptions(statsInput(get)))
    prefetch(trpc.kpis.parties.queryOptions(listInput(get)))

    return (
        <ListPageShell
            header={
                <HydrateClient>
                    <ErrorBoundary fallback={<KpisHeaderSkeleton />}>
                        <Suspense fallback={<KpisHeaderSkeleton />}>
                            <KpisHeaderView />
                        </Suspense>
                    </ErrorBoundary>
                </HydrateClient>
            }
            stats={
                <HydrateClient>
                    <ErrorBoundary fallback={<TilesSkeleton />}>
                        <Suspense fallback={<TilesSkeleton />}>
                            <KpisStatsView />
                        </Suspense>
                    </ErrorBoundary>
                </HydrateClient>
            }
            data={
                <HydrateClient>
                    <ErrorBoundary fallback={<ListError message={t("error")} />}>
                        <Suspense fallback={<ListSkeleton />}>
                            <KpisDataView />
                        </Suspense>
                    </ErrorBoundary>
                </HydrateClient>
            }
        />
    )
}
