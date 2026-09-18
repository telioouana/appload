"use client"

import { useState } from "react"
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
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { useTRPC } from "@/backend/api/client"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { overviewInput } from "@/frontend/pages/metrics/types"

/** Commission first: it is the figure Claire asks about, so it is the one the card opens on. */
const METRICS = ["commission", "sales", "net"] as const

type Metric = (typeof METRICS)[number]

/**
 * The same three colours the revenue card uses, so a measure wears one colour
 * across the whole page and switching the toggle never repaints a meaning —
 * including the pair per theme, which is what keeps every one of them clear
 * of the card behind it in both. The note on that card has the numbers.
 */
const METRIC_COLOR: Record<Metric, { light: string; dark: string }> = {
    commission: { light: "var(--chart-4)", dark: "var(--chart-2)" },
    sales: { light: "var(--chart-5)", dark: "var(--chart-1)" },
    net: { light: "var(--chart-3)", dark: "var(--chart-4)" },
}

/** Months behind the trailing mean, including the month it is drawn on. */
const WINDOW = 3

/**
 * Every month Appload has traded, one bar each, with a three-month trailing
 * mean laid over them. Monthly revenue in this business swings by a factor of
 * three between a quiet August and a busy October; the line is what says
 * whether the swing is a trend or just the month.
 *
 * The mean starts on the third bar rather than averaging one month with
 * itself — a ramp out of thin air would read as growth that never happened.
 */
export function MonthlyTrend() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const [metric, setMetric] = useState<Metric>("commission")
    const { currency, code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const months = data.months

    const metricLabel: Record<Metric, string> = {
        commission: t("trend.metric.commission"),
        sales: t("trend.metric.sales"),
        net: t("trend.metric.net"),
    }

    const config = {
        value: { label: metricLabel[metric], theme: METRIC_COLOR[metric] },
        // The mean is a reading of the bars, not a fourth series competing
        // with them, so it wears ink rather than a hue of its own
        average: { label: t("trend.average"), color: "var(--muted-foreground)" },
    } satisfies ChartConfig

    const points = months.map((month, index) => {
        const trailing = months.slice(Math.max(0, index - (WINDOW - 1)), index + 1).map((entry) => entry.money[currency][metric])

        return {
            // Not "key": recharts spreads a row onto its rectangle and passes
            // anything SVG-shaped straight through, and React would read a
            // field called `key` as the element's key
            stamp: month.key,
            value: month.money[currency][metric],
            // The month still filling up is left out of the mean as well as
            // out of the windows behind it: three weeks averaged against two
            // whole months dips the line at the right edge every month, next
            // to the one bar already dimmed for saying exactly that
            average:
                month.partial || trailing.length < WINDOW
                    ? undefined
                    : trailing.reduce((sum, value) => sum + value, 0) / WINDOW,
            // recharts spreads a row's own props onto the rectangle it draws,
            // which is how the month still filling up comes out half-strength
            // without a <Cell> the UI package does not re-export
            ...(month.partial && { fillOpacity: 0.5 }),
        }
    })

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const midMonth = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15))

    // Past two years of bars there is no room for twelve labels a year. Only
    // the ticks carrying a year survive, so a five-year axis still says where
    // you are standing; below that every month keeps its name.
    const dense = months.length > 24

    const axis = new Map<string, string>(months.map((month, index) => {
        const short = f.dateTime(midMonth(month.year, month.month), { month: "short" })
        const opensAYear = month.month === 1 || index === 0

        return [month.key, opensAYear ? `${short} ${month.year}` : dense ? "" : short]
    }))

    // The tooltip says the month in full, and marks the one still filling up
    const titles = new Map<string, string>(months.map((month) => {
        const title = f.dateTime(midMonth(month.year, month.month), { month: "long", year: "numeric" })

        return [month.key, month.partial ? `${title} · ${t("to-date")}` : title]
    }))

    const money = (value: number) => f.number(value, { maximumFractionDigits: 0 })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <h2 className="text-sm font-medium">{t("trend.title", { currency: code })}</h2>

                <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    spacing={0}
                    aria-label={t("trend.toggle")}
                    value={metric}
                    onValueChange={(value) => {
                        // Radix hands back "" when the pressed item is pressed
                        // again; the chart always plots something, so that
                        // deselection is simply ignored
                        if ((METRICS as readonly string[]).includes(value)) setMetric(value as Metric)
                    }}
                >
                    {METRICS.map((key) => (
                        <ToggleGroupItem key={key} value={key} className="text-xs">
                            {metricLabel[key]}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </header>

            {points.length === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("trend.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <ComposedChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        {/* The month stamp is the axis category — unique per
                            month, so the blanked-out ticks cannot collide */}
                        <XAxis
                            dataKey="stamp"
                            interval={0}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11 }}
                            tickMargin={8}
                            tickFormatter={(value: string) => axis.get(value) ?? ""}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            // Sized to its ticks: "750 mil" in meticais is twice the
                            // width of "50K" in dollars, and a fixed width clipped it
                            width="auto"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => f.number(value, { notation: "compact" })}
                        />

                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(label) => titles.get(String(label)) ?? String(label)}
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
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
                        <Line
                            type="monotone"
                            dataKey="average"
                            stroke="var(--color-average)"
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
