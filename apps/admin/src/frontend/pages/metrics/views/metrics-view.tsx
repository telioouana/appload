"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconTable } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { CardBoundary, CardSkeleton, Quiet } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { CurrencyToggle } from "@/frontend/pages/metrics/components/currency-toggle"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { MarginByYear } from "@/frontend/pages/metrics/sections/margin-by-year"
import { MonthlyTrend } from "@/frontend/pages/metrics/sections/monthly-trend"
import { MonthsTable } from "@/frontend/pages/metrics/sections/months-table"
import { PartnersByMonth } from "@/frontend/pages/metrics/sections/partners-by-month"
import { RevenueByYear } from "@/frontend/pages/metrics/sections/revenue-by-year"
import { TripsByMonth } from "@/frontend/pages/metrics/sections/trips-by-month"
import { YearsTable } from "@/frontend/pages/metrics/sections/years-table"
import { YtdTiles } from "@/frontend/pages/metrics/sections/ytd-tiles"
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * The door to where the numbers actually live. A plain `a`, not the locale
 * `Link`: this leaves the admin for Google's own domain, so the router has
 * nothing to route.
 */
function OpenSheet() {
    const t = useTranslations("Admin.metrics")
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    return (
        <Button asChild size="sm" variant="outline">
            <a href={data.sheetUrl} target="_blank" rel="noreferrer">
                <IconTable className="size-4" stroke={1.5} />
                {t("open-sheet")}
            </a>
        </Button>
    )
}

/**
 * When the sheet could not be read, the page serves the last snapshot it
 * holds rather than an empty board — and says which morning it is from, so
 * nobody quotes a stale figure in a meeting.
 */
function StaleNote() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    if (!data.stale) return null

    return (
        <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("stale", { time: f.dateTime(new Date(data.fetchedAt), { dateStyle: "medium", timeStyle: "short" }) })}
        </p>
    )
}

/**
 * How Appload has done since it started trading: this year against the last,
 * then the whole timeline — revenue and margin by year, the months in a row,
 * the work and the partners behind them, what currency the money arrived in,
 * and the two tables the figures come from.
 *
 * Every card reads one query, so the page is one read of one spreadsheet;
 * they still stream and fail behind their own boundaries, as on the
 * dashboard, because a rate the feed would not answer for should cost a card
 * and not the page.
 *
 * The currency toggle in the header re-presents every figure at once; the
 * year select lives on the month table at the foot, the one card it drives —
 * everything above it is the whole timeline, which is the point of the page.
 */
export function MetricsView() {
    const t = useTranslations("Admin.metrics")
    const { code } = useMetricsCurrency()

    return (
        <>
            <PageHeader
                title={t("title")}
                description={t("description", { currency: code })}
                below={<Quiet><StaleNote /></Quiet>}
                actions={
                    <>
                        <CurrencyToggle />

                        <Quiet fallback={<Skeleton className="h-8 w-28 rounded-lg" />}>
                            <OpenSheet />
                        </Quiet>
                    </>
                }
            />

            {/* The bands are `shrink-0`: in a scrolling flex column a band
                would otherwise be squeezed to fit instead of scrolling */}
            <div className="container-snap flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
                <div className="shrink-0">
                    <CardBoundary fallback={<TilesSkeleton />} message={t("error")}>
                        <YtdTiles />
                    </CardBoundary>
                </div>

                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-3 xl:items-stretch">
                    {/* A grid of one so the chart card fills the taller of the
                        pair; the boundary itself renders no element to span */}
                    <div className="grid min-w-0 xl:col-span-2">
                        <CardBoundary
                            className="mx-0"
                            fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                            message={t("error")}
                        >
                            <RevenueByYear />
                        </CardBoundary>
                    </div>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <MarginByYear />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <MonthlyTrend />
                    </CardBoundary>
                </div>

                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-2 xl:items-stretch">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <TripsByMonth />
                    </CardBoundary>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <PartnersByMonth />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[420px]" />}
                        message={t("error")}
                    >
                        <YearsTable />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[420px]" />}
                        message={t("error")}
                    >
                        <MonthsTable />
                    </CardBoundary>
                </div>
            </div>
        </>
    )
}
