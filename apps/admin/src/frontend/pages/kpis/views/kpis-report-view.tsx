"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowLeft } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { Link } from "@/i18n/navigation"
import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { CardBoundary, CardSkeleton, Quiet } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"
import { DownloadMenu } from "@/frontend/pages/kpis/components/download-menu"
import { PartyPicker } from "@/frontend/pages/kpis/components/party-picker"
import { PeriodControl } from "@/frontend/pages/kpis/components/period-control"
import { useKpiParams } from "@/frontend/pages/kpis/hooks/use-kpi-params"
import { usePeriodLabel } from "@/frontend/pages/kpis/hooks/use-period-label"
import { BackloadCard } from "@/frontend/pages/kpis/sections/backload-card"
import { DaysChart } from "@/frontend/pages/kpis/sections/days-chart"
import { IncidentsChart } from "@/frontend/pages/kpis/sections/incidents-chart"
import { KpiTable } from "@/frontend/pages/kpis/sections/kpi-table"
import { PriceChart } from "@/frontend/pages/kpis/sections/price-chart"
import { ReportTiles } from "@/frontend/pages/kpis/sections/report-tiles"
import { TransportsChart } from "@/frontend/pages/kpis/sections/transports-chart"
import { carriedQuery, reportInput } from "@/frontend/pages/kpis/types"

/**
 * The KPI report Claire used to keep in a spreadsheet, for the one shipper or
 * carrier the route names: the four headline figures, how the transports and
 * the price moved through the period, where the days went, what went wrong,
 * what backloading was worth, and then every indicator the PDF prints.
 *
 * The party is a route segment and the period a query string, so Back from
 * here is the list this was opened from, on the stretch it was read over —
 * the browser keeps that entry, and the picker's own navigations are careful
 * not to bury it. The period controls still replace rather than stack, as on
 * every list page.
 *
 * The party's name is the page title, so this view reads the report itself
 * rather than leaving the header blank: the route prefetched it, so this
 * hydrates instead of asking again. Every card below queries through the same
 * builder and streams and fails behind its own boundary, because one unhappy
 * figure should cost a card and not the report.
 *
 * Money is USD throughout, converted at each trip's own loading-day rate; the
 * tiles band carries the note that says so.
 */
export function KpisReportView() {
    const t = useTranslations("Admin.kpis")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()
    const { period } = useKpiParams()

    const label = usePeriodLabel(period)

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    return (
        <>
            <PageHeader
                // The list this was opened from, on the same stretch — the
                // way back for anyone who did not arrive by clicking a row
                leading={
                    <Button asChild size="icon" variant="outline" aria-label={t("back")} className="mt-4 shrink-0">
                        <Link href={{ pathname: "/kpis", query: carriedQuery((key) => searchParams.get(key)) }}>
                            <IconArrowLeft className="size-4" stroke={1.5} />
                        </Link>
                    </Button>
                }
                eyebrow={[t("title")]}
                title={report.party.name}
                description={t("description", { period: label })}
                below={
                    <div className="pt-1">
                        <PeriodControl />
                    </div>
                }
                actions={
                    <>
                        <Quiet fallback={<Skeleton className="h-8 w-44 rounded-lg" />}>
                            <PartyPicker name={report.party.name} />
                        </Quiet>

                        <Quiet>
                            <DownloadMenu />
                        </Quiet>
                    </>
                }
            />

            {/* The bands are `shrink-0`: in a scrolling flex column a band
                would otherwise be squeezed to fit instead of scrolling */}
            <div className="container-snap flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
                <div className="shrink-0">
                    <CardBoundary
                        fallback={
                            <>
                                <TilesSkeleton />
                                {/* The tiles carry the conversion note under
                                    them; without its line the band grows once
                                    they land */}
                                <Skeleton className="mx-2 mt-2 h-4 w-72 rounded-md" />
                            </>
                        }
                        message={t("error")}
                    >
                        <ReportTiles />
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

                <div className="grid shrink-0 gap-4 px-2 xl:grid-cols-3 xl:items-stretch">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <DaysChart />
                    </CardBoundary>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <IncidentsChart />
                    </CardBoundary>

                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[300px] xl:h-[340px]" />}
                        message={t("error")}
                    >
                        <BackloadCard />
                    </CardBoundary>
                </div>

                <div className="shrink-0 px-2">
                    <CardBoundary
                        className="mx-0"
                        fallback={<CardSkeleton className="mx-0 h-[420px]" />}
                        message={t("error")}
                    >
                        <KpiTable />
                    </CardBoundary>
                </div>
            </div>
        </>
    )
}
