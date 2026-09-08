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
import { Link, useRouter } from "@/i18n/navigation"
import { yearInput } from "@/frontend/pages/dashboard/types"
import { currentYear } from "@/frontend/pages/orders/types"

/**
 * Bottom to top, the way a trip leaves the board: what finished sits at the
 * foot of the column, what has not started yet at its head. The last band is
 * the one recharts draws on top, so it is the one that gets the rounding.
 */
const SERIES = ["completed", "delivered", "active", "prospect", "lost"] as const

/**
 * The year's orders by loading month, stacked by outcome. A column is a door
 * like every other number on this page: clicking one opens exactly the orders
 * it counts, on the list, for that month.
 */
export function OrdersByMonth({ year }: { year?: number }) {
    const t = useTranslations("Admin.dashboard")
    const f = useFormatter()
    const trpc = useTRPC()
    const router = useRouter()

    const { data } = useSuspenseQuery(trpc.dashboard.monthly.queryOptions(yearInput(year)))

    // Status tokens, not the --chart-* ramp: that ramp is a single-hue scale
    // and these five series are categorical. Both themes define them.
    // "Delivered" borrows the offloading teal rather than its own badge green:
    // stacked against "completed" the two greens are one colour in dark mode.
    const config = {
        completed: { label: t("chart.series.completed"), color: "var(--status-completed-text)" },
        delivered: { label: t("chart.series.delivered"), color: "var(--status-offloading-text)" },
        active: { label: t("chart.series.active"), color: "var(--status-on-route-text)" },
        prospect: { label: t("chart.series.prospect"), color: "var(--status-prospect-text)" },
        lost: { label: t("chart.series.lost"), color: "var(--status-cancelled-text)" },
    } satisfies ChartConfig

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const points = data.months.map((point) => ({
        ...point,
        label: f.dateTime(new Date(Date.UTC(data.year, point.month - 1, 15)), { month: "short" }),
    }))

    // The year rides in the URL only when it is not the current one, so the
    // list lands on the same scope the chart was showing
    const monthQuery = (month: number) => ({
        month: String(month),
        ...(data.year !== currentYear() && { year: String(data.year) }),
    })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-medium">{t("chart.title")}</h2>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {t("chart.total", { count: data.totals.total, year: data.year })}
                </span>
            </header>

            {data.totals.total === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("chart.empty", { year: data.year })}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <BarChart
                        data={points}
                        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                        onClick={(state) => {
                            // The chart's own click covers the whole wrapper —
                            // legend and axes included — so it only counts while
                            // a column is actually under the pointer, and only
                            // for a month that has orders to open
                            if (!state.isTooltipActive) return
                            // recharts hands the index back as a string, and null
                            // for a click that landed on no column at all
                            const index = Number(state.activeTooltipIndex ?? NaN)
                            const point = Number.isInteger(index) ? points[index] : undefined
                            if (point?.total) router.push({ pathname: "/orders/all", query: monthQuery(point.month) })
                        }}
                    >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} />

                        <ChartTooltip content={<ChartTooltipContent />} />
                        {/* recharts sorts legend items by data key unless told
                            not to; the stack order is the one that reads */}
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        {SERIES.map((key, index) => (
                            <Bar
                                key={key}
                                dataKey={key}
                                stackId="orders"
                                fill={`var(--color-${key})`}
                                radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                                // Only the columns advertise themselves as doors;
                                // the class lands on the bars' layer, not the card
                                className="cursor-pointer"
                            />
                        ))}
                    </BarChart>
                </ChartContainer>
            )}

            {/* A column can only be clicked. These are the same doors for a
                keyboard and a screen reader — one per month that has orders,
                labelled with the month the axis shows */}
            <ul className="sr-only">
                {points.filter((point) => point.total > 0).map((point) => (
                    <li key={point.month}>
                        <Link href={{ pathname: "/orders/all", query: monthQuery(point.month) }}>
                            {point.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    )
}
