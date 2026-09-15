"use client"

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

import { cn } from "@workspace/ui/lib/utils"

import type { AnalyticsMonthly } from "@/frontend/pages/analytics/types"

/**
 * The year's orders by loading month: how many were filed, how many of them
 * were delivered, and the tonnage that rode with them.
 *
 * The two counts stand side by side rather than stacked, because the
 * delivered ones are part of the orders beside them — stacking would count
 * them twice. Tonnage keeps its own axis on the right: it is a different
 * quantity from a count, and on the same scale a heavy month would flatten
 * every column.
 *
 * The card takes its data as a prop: the analytics page fetches the year it
 * is being read over, the dashboard hands over the year it already holds,
 * and neither has to know how the other asked.
 */
export function OrdersByMonth({ data, className }: { data: AnalyticsMonthly; className?: string }) {
    const t = useTranslations("App.analytics.monthly")
    const f = useFormatter()

    // Status tokens for the delivered band, not the --chart-* ramp: that ramp
    // is a single-hue scale and these series are categorical. The other two
    // carry a value per theme, because a step that separates them on a light
    // card can collapse into one colour on a dark one.
    const config = {
        orders: { label: t("series.orders"), theme: { light: "var(--chart-5)", dark: "var(--chart-1)" } },
        delivered: { label: t("series.delivered"), color: "var(--status-delivered-text)" },
        tons: { label: t("series.tons"), theme: { light: "var(--chart-3)", dark: "var(--chart-4)" } },
    } satisfies ChartConfig

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const points = data.months.map((point) => ({
        ...point,
        label: f.dateTime(new Date(Date.UTC(data.year, Number(point.month.slice(5, 7)) - 1, 15)), { month: "short" }),
    }))

    const total = points.reduce((sum, point) => sum + point.orders, 0)

    // Counts are whole, tonnage lives in the tenths — a load of 1.4 t printed
    // as 1 would be a different load
    const reading = (value: unknown, name: unknown) => {
        if (typeof value !== "number") return "—"

        return name === "tons" ? f.number(value, { maximumFractionDigits: 1 }) : f.number(value)
    }

    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-medium">{t("title")}</h2>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {t("total", { count: total, year: data.year })}
                </span>
            </header>

            {total === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("empty", { year: data.year })}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <ComposedChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                        <YAxis
                            yAxisId="count"
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            width="auto"
                            tick={{ fontSize: 11 }}
                        />
                        <YAxis
                            yAxisId="tons"
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

                        <Bar yAxisId="count" dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="count" dataKey="delivered" fill="var(--color-delivered)" radius={[4, 4, 0, 0]} />
                        <Line
                            yAxisId="tons"
                            type="monotone"
                            dataKey="tons"
                            stroke="var(--color-tons)"
                            strokeWidth={2}
                            dot={false}
                        />
                    </ComposedChart>
                </ChartContainer>
            )}
        </section>
    )
}
