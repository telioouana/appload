"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * What a year of work was worth per trip, and how much of the money that
 * moved through Appload stayed with it. Three figures a year, newest first,
 * in the same `dl` the dashboard's money card reads in — a year is a block,
 * not a row, so the eye compares like with like down the column.
 *
 * Both per-trip figures divide by trips. The sheet divides sales by
 * deliveries and commission by trips, which makes the two numbers
 * incomparable; the footnote says which rule this card uses.
 */
export function MarginByYear() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()
    const { currency, code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const percent = (value: number | null) =>
        value === null ? "—" : f.number(value, { style: "percent", maximumFractionDigits: 1 })

    const money = (value: number | null) => (value === null ? "—" : f.number(value, { maximumFractionDigits: 0 }))

    // Newest first: the year being lived in is the one worth reading first
    const years = [...data.years].reverse()

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">{t("margin.title")}</h2>
                <span className="text-muted-foreground shrink-0 text-xs">{code}</span>
            </header>

            {years.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("margin.empty")}</p>
            ) : (
                // Beside the chart, five years of blocks outgrow it long
                // before the page does, so there the card keeps its height
                // and the list scrolls inside it. Stacked on a narrow screen
                // the page already scrolls, and a second scroller inside it
                // would only hide the older years
                <div className="container-snap flex flex-col gap-4 xl:max-h-[244px] xl:overflow-y-auto">
                    {years.map((year) => {
                        const rows = [
                            { key: "margin", label: t("margin.margin"), value: percent(year.margin), emphasis: true },
                            { key: "commission", label: t("margin.commission-per-trip"), value: money(year.money[currency].commissionPerTrip) },
                            { key: "sales", label: t("margin.sales-per-trip"), value: money(year.money[currency].salesPerTrip) },
                        ]

                        return (
                            <div key={year.year}>
                                <span className="text-muted-foreground text-xs font-medium">
                                    {year.partial ? t("year-to-date", { year: String(year.year) }) : year.year}
                                </span>

                                <dl className="mt-1">
                                    {rows.map((row) => (
                                        <div
                                            key={row.key}
                                            className="flex items-baseline justify-between gap-4 border-t py-2 text-[13px]"
                                        >
                                            <dt className="text-muted-foreground">{row.label}</dt>
                                            <dd className={cn("tabular-nums", row.emphasis && "font-semibold")}>
                                                {row.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )
                    })}
                </div>
            )}

            <p className="text-muted-foreground text-xs">{t("margin.note")}</p>
        </section>
    )
}
