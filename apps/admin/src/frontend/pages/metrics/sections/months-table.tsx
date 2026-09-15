"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { useTRPC } from "@/backend/api/client"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { YearSelect } from "@/frontend/pages/dashboard/components/year-select"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { metricsYear, overviewInput } from "@/frontend/pages/metrics/types"

/**
 * The selected year month by month — the same figures as the years table, in
 * USD at each month's own pinned rate. A ≈ beside a month says its rate was
 * borrowed from a neighbour, so that row is close rather than exact.
 *
 * The year comes from `?year=`, written by the select in this card's own
 * header — it is the one card the year applies to, so the control sits on
 * it; an absent param means the year being lived in, which is what the
 * timeline ends on. Shippers and carriers are names counted once within the
 * month.
 */
export function MonthsTable() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { currency, code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const year = metricsYear((key) => searchParams.get(key))
    const focus = year ?? Number(data.currentMonth.slice(0, 4))
    const months = data.months.filter((month) => month.year === focus)

    const money = (amount: number) => f.number(amount, { maximumFractionDigits: 0 })
    const perTrip = (amount: number | null) => (amount === null ? "—" : f.number(amount, { maximumFractionDigits: 0 }))
    const percent = (amount: number | null) =>
        amount === null ? "—" : f.number(amount, { style: "percent", maximumFractionDigits: 1 })

    const head = "h-8 px-2 text-right text-xs font-normal whitespace-nowrap"
    const cell = "px-2 py-2 text-right tabular-nums"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            {/* Every money column names its own unit, so the card does not */}
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("table.months")}</h2>
                <YearSelect year={focus} />
            </header>

            {months.length === 0 ? (
                <Empty className="border-none py-10">
                    <EmptyHeader>
                        <EmptyTitle>{t("table.empty", { year: String(focus) })}</EmptyTitle>
                        <EmptyDescription>{t("table.empty-description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <Scroller axis="x" className="[&_[data-slot=table-container]]:overflow-visible">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="bg-card sticky left-0 z-10 h-8 px-2 text-xs font-normal">
                                    {t("table.columns.month")}
                                </TableHead>
                                <TableHead className={head}>{t("table.columns.trips")}</TableHead>
                                <TableHead className={head}>{t("table.columns.deliveries")}</TableHead>
                                <TableHead className={head}>{t("table.columns.distance")}</TableHead>
                                <TableHead className={head}>{t("table.columns.shippers")}</TableHead>
                                <TableHead className={head}>{t("table.columns.carriers")}</TableHead>
                                <TableHead className={head}>{t("table.columns.sales", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.commission", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.vat", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.net", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.insurance", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.prospects", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.margin")}</TableHead>
                                <TableHead className={head}>{t("table.columns.sales-per-trip")}</TableHead>
                                <TableHead className={head}>{t("table.columns.commission-per-trip")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {months.map((month) => {
                                // Mid-month at UTC: Maputo is UTC+2, so the
                                // name can never slip into the month before
                                const name = f.dateTime(new Date(Date.UTC(month.year, month.month - 1, 15)), { month: "short" })

                                return (
                                    <TableRow key={month.key} className="hover:bg-transparent">
                                        <TableCell className="bg-card sticky left-0 z-10 px-2 py-2 text-left whitespace-nowrap">
                                            {month.partial ? `${name} ${t("to-date")}` : name}
                                            {/* A month the feed could not answer for
                                                borrows a neighbour's rate; the mark
                                                says the figures in the row are close,
                                                not exact */}
                                            {month.rate.provisional && (
                                                <Tooltip>
                                                    {/* A button, not a span: only
                                                        something focusable can be
                                                        reached to read what the
                                                        mark means */}
                                                    <TooltipTrigger asChild>
                                                        <button
                                                            type="button"
                                                            aria-label={t("rates.provisional")}
                                                            className="text-muted-foreground focus-visible:ring-ring/50 ml-1 cursor-default rounded-sm outline-none focus-visible:ring-3"
                                                        >
                                                            ≈
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>{t("rates.provisional")}</TooltipContent>
                                                </Tooltip>
                                            )}
                                        </TableCell>

                                        <TableCell className={cell}>
                                            {f.number(month.trips.total)}
                                            <span className="text-muted-foreground block text-[11px] leading-tight">
                                                {`${f.number(month.trips.national)} / ${f.number(month.trips.regional)}`}
                                            </span>
                                        </TableCell>

                                        <TableCell className={cell}>{f.number(month.deliveries)}</TableCell>
                                        <TableCell className={cell}>{money(month.distanceKm)}</TableCell>
                                        <TableCell className={cell}>{f.number(month.shippers)}</TableCell>
                                        <TableCell className={cell}>{f.number(month.carriers)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].sales)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].commission)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].iva)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].net)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].insurance)}</TableCell>
                                        <TableCell className={cell}>{money(month.money[currency].prospects)}</TableCell>
                                        <TableCell className={cell}>{percent(month.margin)}</TableCell>
                                        <TableCell className={cell}>{perTrip(month.money[currency].salesPerTrip)}</TableCell>
                                        <TableCell className={cell}>{perTrip(month.money[currency].commissionPerTrip)}</TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </Scroller>
            )}
        </section>
    )
}
