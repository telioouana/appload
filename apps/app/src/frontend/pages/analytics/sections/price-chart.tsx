"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
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
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"

import { useTRPC } from "@/backend/api/client"
import { useBucketAxis } from "@/frontend/pages/analytics/hooks/use-bucket-axis"
import { analyticsInput } from "@/frontend/pages/analytics/types"

/**
 * What the period was worth, month by month, with the value of a single
 * transport laid over it. The two answer each other: a month whose total
 * jumped because there were more loads is not a month whose loads got
 * dearer, and only the pair says which of the two happened.
 *
 * The amounts are this company's own leg — what a client pays or what a
 * carrier invoices — converted to USD at each trip's own loading-day rate,
 * so a step in the columns is the work changing and never the exchange rate.
 * A bucket whose trips have no rate yet has nothing to show and leaves a gap.
 */
export function PriceChart() {
    const t = useTranslations("App.analytics.charts.price")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const { data } = useSuspenseQuery(trpc.analytics.kpis.queryOptions(analyticsInput(get)))

    const { axisLabel, title } = useBucketAxis(data.period.from, data.period.to)

    // The two money hues, each with its own pair per theme: --chart-* is a
    // single-hue ramp, so a step that separates two series on a light card
    // can collapse into one colour on a dark one
    const config = {
        usd: { label: t("total"), theme: { light: "var(--chart-4)", dark: "var(--chart-2)" } },
        perTransport: { label: t("per-transport"), theme: { light: "var(--chart-3)", dark: "var(--chart-4)" } },
    } satisfies ChartConfig

    // What one transport was worth, from the two figures the bucket already
    // carries — a bucket with no money or no trips has no average to show
    const points = data.buckets.map((bucket) => ({
        ...bucket,
        perTransport: bucket.usd !== null && bucket.transports > 0 ? bucket.usd / bucket.transports : null,
    }))

    const money = (value: number) => f.number(value, { maximumFractionDigits: 0 })

    const reading = (value: unknown) => (typeof value === "number" ? money(value) : "—")

    // Two different silences, and saying the wrong one is a claim the reader
    // would act on: a period with no loads at all, and a period that moved
    // cargo whose trips carry no converted amount — the chart beside this one
    // draws its columns for the second, so this card cannot say nothing moved
    const silence = data.buckets.every((bucket) => bucket.transports === 0)
        ? t("empty")
        : points.every((point) => point.usd === null || point.usd === 0)
            ? t("no-values")
            : null

    // What the total leaves out, said out loud rather than hidden inside a
    // smaller number: a trip whose loading day had no rate is not converted
    // at all, and one that borrowed an earlier day's rate is provisional
    const note = [t("note")]

    if (data.figures.provisionalTransports > 0) {
        note.push(t("provisional", { count: data.figures.provisionalTransports }))
    }
    if (data.figures.unratedTransports > 0) {
        note.push(t("unrated", { count: data.figures.unratedTransports }))
    }

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("title")}</h2>

            {silence ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {silence}
                </p>
            ) : (
                <>
                    <ChartContainer
                        config={config}
                        className="h-[220px] w-full xl:h-[260px]"
                        initialDimension={{ width: 640, height: 260 }}
                    >
                        <ComposedChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" />
                            <XAxis
                                dataKey="start"
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontSize: 11 }}
                                tickMargin={8}
                                tickFormatter={(value: string) => axisLabel(value)}
                            />
                            <YAxis
                                yAxisId="total"
                                tickLine={false}
                                axisLine={false}
                                // Sized to its ticks: a period's total runs to
                                // more figures than one transport's share
                                width="auto"
                                tick={{ fontSize: 11 }}
                                tickFormatter={(value: number) => f.number(value, { notation: "compact" })}
                            />
                            <YAxis
                                yAxisId="each"
                                orientation="right"
                                tickLine={false}
                                axisLine={false}
                                width="auto"
                                tick={{ fontSize: 11 }}
                                tickFormatter={(value: number) => f.number(value, { notation: "compact" })}
                            />

                            <ChartTooltip
                                content={
                                    <ChartTooltipContent
                                        labelFormatter={(label) => title(String(label))}
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
                                                    {reading(value)}
                                                </span>
                                            </>
                                        )}
                                    />
                                }
                            />
                            {/* recharts sorts legend items by data key unless
                                told not to; the order the chart is read in is
                                the one the columns and then the line were
                                declared in */}
                            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                            <Bar yAxisId="total" dataKey="usd" fill="var(--color-usd)" radius={[4, 4, 0, 0]} />
                            <Line
                                yAxisId="each"
                                type="monotone"
                                dataKey="perTransport"
                                stroke="var(--color-perTransport)"
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                            />
                        </ComposedChart>
                    </ChartContainer>

                    <p className="text-muted-foreground text-xs">{note.join(" · ")}</p>
                </>
            )}
        </section>
    )
}
