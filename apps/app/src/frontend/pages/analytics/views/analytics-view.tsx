"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@/components/list/page-header"
import { TilesSkeleton } from "@/frontend/components/list-fallbacks"
import { PeriodControl } from "@/frontend/pages/analytics/components/period-control"
import { usePeriodLabel } from "@/frontend/pages/analytics/hooks/use-period-label"
import { KpiTiles } from "@/frontend/pages/analytics/sections/kpi-tiles"
import { MoneyCard } from "@/frontend/pages/analytics/sections/money-card"
import { OrdersByMonth } from "@/frontend/pages/analytics/sections/orders-by-month"
import { PartnersRanking } from "@/frontend/pages/analytics/sections/partners-ranking"
import { PipelineTiles } from "@/frontend/pages/analytics/sections/pipeline-tiles"
import { PriceChart } from "@/frontend/pages/analytics/sections/price-chart"
import { TransportsChart } from "@/frontend/pages/analytics/sections/transports-chart"
import { analyticsInput } from "@/frontend/pages/analytics/types"
import { CardBoundary, CardSkeleton } from "@/frontend/pages/analytics/views/analytics-fallbacks"

/**
 * The chart and the money card are handed their data, because the dashboard
 * shows the same two cards from queries it has already made. Here they own
 * their query, and each one behind its own boundary — so the pair below
 * streams in as it lands rather than waiting on the slower of the two.
 */
function MonthlyCard({ year }: { year: number }) {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.analytics.monthly.queryOptions({ year }))

    return <OrdersByMonth data={data} />
}

function MoneyPanel({ year }: { year: number }) {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.analytics.money.queryOptions({ year }))

    return <MoneyCard data={data} />
}

/**
 * The company's own report: where its order book stands today, how the year
 * loaded and what it is worth, how the period's transports actually went,
 * and who moved them.
 *
 * Every figure is this company's own — its orders, its leg of the money,
 * its partners — and every card streams and fails behind its own boundary,
 * because one unhappy query should cost a card and not the page.
 *
 * The period lives in the URL, read here with the same parser the RSC page
 * prefetched with, so nothing refetches on hydration and a link to a stretch
 * opens on that stretch.
 */
export function AnalyticsView() {
    const t = useTranslations("App.analytics")
    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const { period, year } = analyticsInput(get)
    const label = usePeriodLabel(period, year)

    return (
        <>
            <PageHeader
                title={t("title")}
                description={t("description", { period: label })}
                below={<PeriodControl period={period} year={year} />}
            />

            {/* The bands are `shrink-0`: in a scrolling flex column a band
                would otherwise be squeezed to fit instead of scrolling */}
            <div className="container-snap flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
                <div className="shrink-0">
                    <CardBoundary fallback={<CardSkeleton className="h-52" />} message={t("error")}>
                        <PipelineTiles />
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
                            <MonthlyCard year={year} />
                        </CardBoundary>
                    </div>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <MoneyPanel year={year} />
                    </CardBoundary>
                </div>

                <div className="flex shrink-0 flex-col gap-3.5">
                    <CardBoundary fallback={<TilesSkeleton />} message={t("error")}>
                        <KpiTiles />
                    </CardBoundary>
                </div>

                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-2 xl:items-stretch">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <TransportsChart />
                    </CardBoundary>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <PriceChart />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[320px]" />}
                        message={t("error")}
                    >
                        <PartnersRanking />
                    </CardBoundary>
                </div>
            </div>
        </>
    )
}
