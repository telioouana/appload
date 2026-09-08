"use client"

import { useParams, useSearchParams } from "next/navigation"
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
import { reportInput } from "@/frontend/pages/kpis/types"

/**
 * What one transport cost through the period, with the cost per kilometre laid
 * over it. The two answer each other: a month whose price per transport jumped
 * because the loads went further is a month whose cost per km did not move,
 * and only the pair says which of the two happened.
 *
 * Both figures are USD, converted at each trip's own loading-day rate, so a
 * step in the columns is the work changing and never the exchange rate.
 */
export function PriceChart() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const { from, to, grain } = report.period

    // The two money hues of the metrics page, each with its own pair per
    // theme: --chart-* is a single-hue ramp, so a step that separates two
    // series on a light card can collapse into one colour on a dark one
    const config = {
        pricePerTransport: {
            label: t("charts.price.price"),
            theme: { light: "var(--chart-4)", dark: "var(--chart-2)" },
        },
        costPerKm: {
            label: t("charts.price.cost-per-km"),
            theme: { light: "var(--chart-3)", dark: "var(--chart-4)" },
        },
    } satisfies ChartConfig

    // `yyyy-mm-dd` sorts as it reads, so clipping a week to the period is a
    // string comparison — no local `Date` to slide a day across a timezone
    const later = (day: string, other: string) => (day > other ? day : other)
    const earlier = (day: string, other: string) => (day < other ? day : other)

    const partsOf = (day: string): [number, number, number] => [
        Number(day.slice(0, 4)),
        Number(day.slice(5, 7)),
        Number(day.slice(8, 10)),
    ]

    const dayAfter = (day: string, count: number) => {
        const [year, month, date] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10)
    }

    // Mid-month and midday at UTC: Maputo is UTC+2, so a label can never slip
    // to the month or the day before the bucket it names
    const midMonth = (day: string) => {
        const [year, month] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, 15))
    }

    const midDay = (day: string) => {
        const [year, month, date] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, date, 12))
    }

    // A period inside one year names its months bare; one that crosses New
    // Year has to say which January it means
    const spansYears = from.slice(0, 4) !== to.slice(0, 4)

    const axisLabel = (start: string) => {
        if (grain === "month") {
            const short = f.dateTime(midMonth(start), { month: "short" })
            return spansYears ? `${short} ${start.slice(0, 4)}` : short
        }

        // A week bucket starts on its ISO Monday, which for the first one is
        // before the period began; the count is scoped, only the label moves
        return f.dateTime(midDay(later(start, from)), { day: "numeric", month: "short" })
    }

    const title = (start: string) => {
        if (grain === "month") return f.dateTime(midMonth(start), { month: "long", year: "numeric" })

        const first = midDay(later(start, from))
        const last = midDay(earlier(dayAfter(start, 6), to))

        return `${f.dateTime(first, { day: "numeric", month: "short" })} – ${f.dateTime(last, { day: "numeric", month: "short" })}`
    }

    // A whole price rounds to the dollar; a cost per kilometre lives in the
    // cents, and rounded to the dollar it would be 0 or 1 all year. A bucket
    // nobody loaded in has neither, and says so rather than printing a zero
    const reading = (value: unknown, name: unknown) => {
        if (typeof value !== "number") return "—"

        return name === "costPerKm"
            ? f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : f.number(value, { maximumFractionDigits: 0 })
    }

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("charts.price.title")}</h2>

            {report.buckets.every((bucket) => bucket.transports === 0) ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("charts.price.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <ComposedChart data={report.buckets} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
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
                            yAxisId="price"
                            tickLine={false}
                            axisLine={false}
                            // Sized to its ticks: four figures of dollars are
                            // twice the width of the two the cost per km takes
                            width="auto"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => f.number(value, { notation: "compact" })}
                        />
                        <YAxis
                            yAxisId="cost"
                            orientation="right"
                            tickLine={false}
                            axisLine={false}
                            width="auto"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => f.number(value, { maximumFractionDigits: 2 })}
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

                        <Bar
                            yAxisId="price"
                            dataKey="pricePerTransport"
                            fill="var(--color-pricePerTransport)"
                            radius={[4, 4, 0, 0]}
                        />
                        <Line
                            yAxisId="cost"
                            type="monotone"
                            dataKey="costPerKm"
                            stroke="var(--color-costPerKm)"
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
