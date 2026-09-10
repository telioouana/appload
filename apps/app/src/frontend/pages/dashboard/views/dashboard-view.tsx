"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { useTRPC } from "@/backend/api/client"

import { LatestOrders } from "@/frontend/pages/dashboard/sections/latest-orders"
import { MonthlyOrders } from "@/frontend/pages/dashboard/sections/monthly-orders"
import { NeedsAHand } from "@/frontend/pages/dashboard/sections/needs-a-hand"
import { OnTheRoad } from "@/frontend/pages/dashboard/sections/on-the-road"
import { PipelineTiles } from "@/frontend/pages/dashboard/sections/pipeline-tiles"
import { TripsTile } from "@/frontend/pages/dashboard/sections/trips-tile"
import { YearMoney } from "@/frontend/pages/dashboard/sections/year-money"
import { CardBoundary, CardSkeleton, TilesSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"

/**
 * The board the day starts on: how the order book stands, what is waiting on
 * a decision, where the loads are, how the year is loading and what it is
 * worth, then the orders filed last.
 *
 * The greeting stays put and the bands scroll under it, as on the order
 * details page — the shell is viewport-locked, so this body is the only thing
 * that moves. Every card streams behind its own boundary: the tiles paint the
 * moment the pipeline lands without waiting on the map, and a card whose
 * procedure fails is replaced by its own error without taking the board down.
 *
 * Both sides of the trade read the same board, with the middle tiles and the
 * queue asking each of them their own question.
 */
export function DashboardView() {
    const t = useTranslations("App.dashboard")
    const tPlan = useTranslations("App.plan")
    const f = useFormatter()
    const trpc = useTRPC()

    // The page's clock: the date in the description and the relative labels in
    // the cards below all move together, once a minute
    const now = useNow({ updateInterval: 60_000 })

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())

    const { plan } = session

    return (
        <>
            <header className="flex flex-col gap-2 px-2">
                <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">
                    {t("greeting", { name: session.user.name.trim() || session.user.email })}
                </h1>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{session.organization.name}</span>
                    <Badge variant="outline">{t(`type.${session.organization.type}`)}</Badge>
                    {/* An expired plan reads as no plan, the way the gate
                        itself reads it */}
                    <Badge variant={plan.active ? "default" : "secondary"}>
                        {tPlan(`names.${plan.active && plan.plan ? plan.plan : "none"}`)}
                    </Badge>
                </div>

                <p className="text-muted-foreground text-sm">
                    {t("description", { date: f.dateTime(now, { dateStyle: "full" }) })}
                </p>
            </header>

            {/* The bands are `shrink-0`: in a scrolling flex column a band would
                otherwise be squeezed to fit instead of scrolling */}
            <div className="container-snap flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
                <div className="shrink-0">
                    <CardBoundary fallback={<TilesSkeleton />} message={t("error")}>
                        <PipelineTiles />
                    </CardBoundary>
                </div>

                {/* Where the loads are, beside what they need: two thirds to the
                    map, one to the queue and the trips it does not cover */}
                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] xl:items-stretch">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[320px] lg:h-[486px]" />}
                        message={t("error")}
                    >
                        <OnTheRoad />
                    </CardBoundary>

                    <div className="flex min-w-0 flex-col gap-4">
                        <CardBoundary
                            className="mx-0"
                            fallback={<CardSkeleton className="mx-0 h-[220px] flex-1" />}
                            message={t("error")}
                        >
                            <NeedsAHand />
                        </CardBoundary>

                        <CardBoundary
                            className="mx-0"
                            fallback={<CardSkeleton className="mx-0 h-[124px]" />}
                            message={t("error")}
                        >
                            <TripsTile />
                        </CardBoundary>
                    </div>
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
                            <MonthlyOrders />
                        </CardBoundary>
                    </div>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <YearMoney />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[360px]" />}
                        message={t("error")}
                    >
                        <LatestOrders />
                    </CardBoundary>
                </div>
            </div>
        </>
    )
}
