"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@workspace/ui/components/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"

import { useTRPC } from "@/backend/api/client"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * Largest first, so the nesting reads left to right inside every group: what
 * the shippers paid, the slice of it Appload invoiced, and what survives the
 * VAT.
 */
const SERIES = ["sales", "commission", "net"] as const

/**
 * Every trading year side by side, in USD converted at each month's own
 * opening rate — the whole point of the page, and the one card where the
 * shape of the business is visible in a glance.
 *
 * Three bars share one scale on purpose. Commission is a tenth of sales and
 * looks like it; a second axis would flatter it into looking like half, which
 * is exactly the lie the dataviz rules forbid. The tables below carry the
 * figures for anyone who needs to read them rather than compare them.
 */
export function RevenueByYear() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()
    const { currency, code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    // A pair per theme rather than one colour for both. globals.css defines
    // --chart-1..5 identically in light and dark while the card under them
    // flips from white to near-black, so any single choice drops a series
    // under the 3:1 floor one way or the other — net at 1.7:1 on the white
    // card, sales at 2.4:1 on the dark one. Each series takes the end of the
    // ramp that stands off its own ground, largest first either way, and the
    // steps stay far enough apart to tell three oranges from one.
    const config = {
        sales: { label: t("revenue.series.sales"), theme: { light: "var(--chart-5)", dark: "var(--chart-1)" } },
        commission: { label: t("revenue.series.commission"), theme: { light: "var(--chart-4)", dark: "var(--chart-2)" } },
        net: { label: t("revenue.series.net"), theme: { light: "var(--chart-3)", dark: "var(--chart-4)" } },
    } satisfies ChartConfig

    // The year rides in as a string: an ICU argument holding a number would be
    // grouped by the locale and print "2 026"
    const points = data.years.map((year) => ({
        label: year.partial ? t("year-to-date", { year: String(year.year) }) : String(year.year),
        sales: year.money[currency].sales,
        commission: year.money[currency].commission,
        net: year.money[currency].net,
    }))

    const money = (value: number) => f.number(value, { maximumFractionDigits: 0 })

    // A year of nothing but zeros plots as an empty frame with an axis, which
    // reads as a broken card rather than an empty one
    const empty = points.every((point) => point.sales === 0 && point.commission === 0 && point.net === 0)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("revenue.title", { currency: code })}</h2>

            {empty ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("revenue.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            // Sized to its ticks: "750 mil" in meticais is twice the
                            // width of "50K" in dollars, and a fixed width clipped it
                            width="auto"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => f.number(value, { notation: "compact" })}
                        />

                        {/* recharts' own tooltip prints `toLocaleString()` with
                            no locale; the formatter replaces the whole row, so
                            it draws the swatch and the label back itself */}
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    formatter={(value, name, item) => (
                                        <>
                                            <span
                                                className="size-2.5 shrink-0 rounded-[2px]"
                                                style={{ backgroundColor: item.color }}
                                            />
                                            <span className="text-muted-foreground flex-1">
                                                {config[String(name) as keyof typeof config]?.label ?? name}
                                            </span>
                                            <span className="text-foreground font-mono font-medium tabular-nums">
                                                {typeof value === "number" ? money(value) : String(value ?? "")}
                                            </span>
                                        </>
                                    )}
                                />
                            }
                        />
                        {/* recharts sorts legend items by data key unless told
                            not to; the nesting order is the one that reads */}
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        {SERIES.map((key) => (
                            <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={[4, 4, 0, 0]} />
                        ))}
                    </BarChart>
                </ChartContainer>
            )}
        </section>
    )
}
