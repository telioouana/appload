"use client"

import { useSearchParams } from "next/navigation"
import { IconMap2 } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { Link } from "@/i18n/navigation"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { OrderSheet } from "@/frontend/pages/orders/views/order-sheet"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { YearSelect } from "@/frontend/pages/dashboard/components/year-select"
import { FleetCard } from "@/frontend/pages/dashboard/sections/fleet-card"
import { LatestOrders } from "@/frontend/pages/dashboard/sections/latest-orders"
import { MoneyCard } from "@/frontend/pages/dashboard/sections/money-card"
import { NeedsAHand } from "@/frontend/pages/dashboard/sections/needs-a-hand"
import { OrdersByMonth } from "@/frontend/pages/dashboard/sections/orders-by-month"
import { PipelineTiles } from "@/frontend/pages/dashboard/sections/pipeline-tiles"
import { dashboardYear } from "@/frontend/pages/dashboard/types"
import { CardBoundary, CardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { currentYear } from "@/frontend/pages/orders/types"

/**
 * The board the day starts on: what needs a hand, where the fleet is, how
 * the year is loading and what it is worth, then the orders touched last.
 *
 * The header stays put and the bands scroll under it, as on the order
 * details page — the shell is viewport-locked, so this body is the only
 * thing that moves. Every card streams behind its own boundary: the tiles
 * paint the moment the stats land without waiting on the map, and a card
 * whose procedure fails (or that the role may not read) is replaced by its
 * own error without taking the board down.
 *
 * The year select drives only the chart and the money card; the tiles, the
 * queue and the map are always now. Both sides of that split read the URL
 * with the same parser the RSC page prefetched with, so nothing refetches
 * on hydration.
 */
export function DashboardView() {
    const t = useTranslations("Admin.dashboard")
    const f = useFormatter()
    const searchParams = useSearchParams()

    // The page's clock: the date in the description and the relative labels
    // in the cards below all move together, once a minute
    const now = useNow({ updateInterval: 60_000 })

    const year = dashboardYear((key) => searchParams.get(key))

    return (
        <>
            <PageHeader
                title={t("title")}
                description={t("description", { date: f.dateTime(now, { dateStyle: "full" }) })}
                actions={
                    <>
                        <YearSelect year={year ?? currentYear()} />

                        <Button asChild size="sm" variant="outline">
                            <Link href="/map">
                                <IconMap2 className="size-4" stroke={1.5} />
                                {t("open-map")}
                            </Link>
                        </Button>
                    </>
                }
            />

            {/* The bands are `shrink-0`: in a scrolling flex column a band
                would otherwise be squeezed to fit instead of scrolling */}
            <div className="container-snap flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
                <div className="shrink-0">
                    <CardBoundary fallback={<TilesSkeleton />} message={t("error")}>
                        <PipelineTiles />
                    </CardBoundary>
                </div>

                {/* Where the fleet is, beside what it needs: two thirds to the
                    map and its rail, one to the queue (approved canvas) */}
                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] xl:items-stretch">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[320px] lg:h-[486px]" />}
                        message={t("error")}
                    >
                        <FleetCard />
                    </CardBoundary>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[320px]" />}
                        message={t("error")}
                    >
                        <NeedsAHand />
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
                            <OrdersByMonth year={year} />
                        </CardBoundary>
                    </div>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <MoneyCard year={year} />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[420px]" />}
                        message={t("error")}
                    >
                        <LatestOrders />
                    </CardBoundary>
                </div>
            </div>

            {/* URL-driven by `?id=`: a table row and the map's open card both
                write it, so an order opens without leaving the board */}
            <OrderSheet />
        </>
    )
}
