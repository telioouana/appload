import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { CardError } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { optionsInput, reportInput } from "@/frontend/pages/kpis/types"
import { KpisReportSkeleton } from "@/frontend/pages/kpis/views/kpis-fallbacks"
import { KpisReportView } from "@/frontend/pages/kpis/views/kpis-report-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.kpis")

    return { title: t("title") }
}

/**
 * One shipper's or carrier's KPI report, over the period the query string
 * names. The party is a route segment rather than a parameter, so opening a
 * report is a real history entry: Back returns to the list it was opened
 * from, on the same period, without the list having to remember anything.
 *
 * Everything the page shows is fetched here, on this request, with the very
 * builders the sections query with — the report itself and the picker's
 * options — so each card hydrates into its prefetched query instead of asking
 * again, and the page streams card by card behind the boundaries the view
 * puts around them.
 *
 * Money is USD everywhere on this page, converted per trip at its own
 * loading-day rate; the procedure does that before anything is divided.
 */
export default async function KpiReport({
    params,
    searchParams,
}: {
    params: Promise<{ party: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const t = await getTranslations("Admin.kpis")
    const { party } = await params
    const search = await searchParams

    // The same reader the client parsers get from `useSearchParams`. A
    // repeated param arrives as an array; take the first entry, as
    // `URLSearchParams.get` does on the client — otherwise `?year=&year=2025`
    // would prefetch one period and hydrate into another
    const get = (key: string) => {
        const value = search[key]
        return (Array.isArray(value) ? value[0] : value) ?? null
    }

    // The raw segment, exactly as `useParams` hands it to the sections below:
    // the two have to hash to one query key or the prefetch is thrown away
    prefetch(trpc.kpis.report.queryOptions(reportInput(party, get)))
    prefetch(trpc.kpis.partyOptions.queryOptions(optionsInput(get)))

    return (
        // The protected layout only pads horizontally; the vertical room and
        // the viewport lock are this page's job, as on the dashboard
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<CardError message={t("error")} />}>
                    <Suspense fallback={<KpisReportSkeleton />}>
                        <KpisReportView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
