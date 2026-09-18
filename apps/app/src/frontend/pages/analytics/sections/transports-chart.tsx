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
 * The period cut into months — or weeks, when it is short enough that months
 * would be one column — with the work as columns and punctuality laid over
 * them. Volume alone says nothing about service and a rate alone says
 * nothing about scale: 100% on the one trip of a quiet week is not the same
 * promise as 90% on twenty, and only the two together show that.
 *
 * The rate keeps its own axis on the right because it is a different
 * quantity from a count, and a month nobody loaded in leaves a gap in the
 * line rather than a zero — no transports is not the same as none on time.
 */
export function TransportsChart() {
    const t = useTranslations("App.analytics.charts.transports")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const { data } = useSuspenseQuery(trpc.analytics.kpis.queryOptions(analyticsInput(get)))

    const { axisLabel, title } = useBucketAxis(data.period.from, data.period.to)

    // Both themes: --chart-* is a single-hue ramp that reads as one colour on
    // one of the two backgrounds, so a series that has to stay itself in both
    // carries a pair
    const config = {
        transports: { label: t("transports"), theme: { light: "var(--chart-5)", dark: "var(--chart-1)" } },
        onTimeRate: { label: t("on-time"), theme: { light: "var(--status-booked-text)", dark: "oklch(0.66 0.14 254)" } },
    } satisfies ChartConfig

    const percent = (value: number) => f.number(value, { style: "percent", maximumFractionDigits: 0 })

    // Counts on the columns, a share on the line — one tooltip, two units. A
    // bucket nobody loaded in has no rate to give, and says so rather than
    // leaving the row blank
    const reading = (value: unknown, name: unknown) => {
        if (typeof value !== "number") return "—"

        return name === "transports" ? f.number(value) : percent(value)
    }

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("title")}</h2>

            {data.buckets.every((bucket) => bucket.transports === 0) ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <ComposedChart data={data.buckets} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
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
                            yAxisId="count"
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            width="auto"
                            tick={{ fontSize: 11 }}
                        />
                        {/* The rate is a share, not a count — its own scale,
                            pinned to the whole 0–100% so a good month and a
                            bad one are the same height apart all year */}
                        <YAxis
                            yAxisId="rate"
                            orientation="right"
                            domain={[0, 1]}
                            ticks={[0, 0.25, 0.5, 0.75, 1]}
                            tickLine={false}
                            axisLine={false}
                            width="auto"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => percent(value)}
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
                                                {reading(value, name)}
                                            </span>
                                        </>
                                    )}
                                />
                            }
                        />
                        {/* recharts sorts legend items by data key unless told
                            not to; the order the chart is read in is the one
                            the columns and then the line were declared in */}
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        <Bar yAxisId="count" dataKey="transports" fill="var(--color-transports)" radius={[4, 4, 0, 0]} />
                        <Line
                            yAxisId="rate"
                            type="monotone"
                            dataKey="onTimeRate"
                            stroke="var(--color-onTimeRate)"
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                        />
                    </ComposedChart>
                </ChartContainer>
            )}
        </section>
    )
}
