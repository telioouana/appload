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
 * The period cut into months — or weeks, when it is short enough that months
 * would be one column — with the work as columns and punctuality laid over
 * them. Volume alone says nothing about service and a rate alone says nothing
 * about scale: 100% on the one trip of a quiet week is not the same promise as
 * 90% on twenty, and the two together are the only way to see that.
 *
 * The rates keep their own axis on the right because they are a different
 * quantity from a count, and a month nobody loaded in leaves a gap in the
 * lines rather than a zero — no transports is not the same as none on time.
 */
export function TransportsChart() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const { from, to, grain } = report.period

    // Both themes, as everywhere on this page: --chart-* is a single-hue
    // ramp that reads as one colour on one of the two backgrounds, so a
    // series that has to stay itself in both carries a pair. The two rate
    // lines are the same blue and green the trips card uses for its split.
    const config = {
        transports: {
            label: t("charts.transports.transports"),
            theme: { light: "var(--chart-5)", dark: "var(--chart-1)" },
        },
        onTimeLoadingRate: {
            label: t("charts.transports.on-time-loading"),
            theme: { light: "var(--status-booked-text)", dark: "oklch(0.66 0.14 254)" },
        },
        onTimeOffloadingRate: {
            label: t("charts.transports.on-time-offloading"),
            theme: { light: "var(--status-delivered-text)", dark: "oklch(0.72 0.15 149)" },
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

    const percent = (value: number) => f.number(value, { style: "percent", maximumFractionDigits: 0 })

    // Counts on the columns, shares on the lines — one tooltip, two units. A
    // bucket nobody loaded in has no rate to give, and says so rather than
    // leaving the row blank
    const reading = (value: unknown, name: unknown) => {
        if (typeof value !== "number") return "—"

        return name === "transports" ? f.number(value) : percent(value)
    }

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("charts.transports.title")}</h2>

            {report.buckets.every((bucket) => bucket.transports === 0) ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("charts.transports.empty")}
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
                            yAxisId="count"
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            width="auto"
                            tick={{ fontSize: 11 }}
                        />
                        {/* The rates are a share, not a count — their own
                            scale, pinned to the whole 0–100% so a good month
                            and a bad one are the same height apart all year */}
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
                            the columns and then the lines were declared in */}
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        <Bar yAxisId="count" dataKey="transports" fill="var(--color-transports)" radius={[4, 4, 0, 0]} />
                        <Line
                            yAxisId="rate"
                            type="monotone"
                            dataKey="onTimeLoadingRate"
                            stroke="var(--color-onTimeLoadingRate)"
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                        />
                        <Line
                            yAxisId="rate"
                            type="monotone"
                            dataKey="onTimeOffloadingRate"
                            stroke="var(--color-onTimeOffloadingRate)"
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
