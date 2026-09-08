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
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * Every month Appload has traded, split into the two kinds of trip it sells:
 * national, inside Mozambique, and regional, across a border. The split is
 * the shape of the business — a regional trip is worth several national ones
 * — so it is what the columns carry.
 *
 * Deliveries ride in the tooltip instead of on the plot. A trip can drop more
 * than one load, so the two counts move together; drawn side by side the gap
 * between them reads as growth when it is only how the loads were split.
 */
export function TripsByMonth() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const months = data.months

    // Not the --chart-* ramp: that ramp is a single-hue scale the money cards
    // took for sales, commission and net, and these two are categorical. The
    // status tokens serve in light mode; their dark counterparts are pale
    // badge text, and stacked columns of them go chalky on a dark card, so
    // dark mode draws the same two hues as saturated mid-tones (as the
    // currency mix does). The pair was checked for colour-blind separation
    // against the card in both themes.
    const config = {
        national: { label: t("trips.series.national"), theme: { light: "var(--status-booked-text)", dark: "oklch(0.66 0.14 254)" } },
        regional: { label: t("trips.series.regional"), theme: { light: "var(--status-delivered-text)", dark: "oklch(0.72 0.15 149)" } },
        // Never drawn — see the hidden bar below
        deliveries: { label: t("trips.deliveries"), color: "var(--muted-foreground)" },
    } satisfies ChartConfig

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const midMonth = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15))

    // Past two years of columns there is no room for twelve labels a year, so
    // only the ticks that open a year keep their text — the same axis the
    // trend card draws, so the two bands read as one timeline
    const dense = months.length > 24

    const axis = new Map(months.map((month, index) => {
        const short = f.dateTime(midMonth(month.year, month.month), { month: "short" })
        const opensAYear = month.month === 1 || index === 0

        return [month.key, opensAYear ? `${short} ${month.year}` : dense ? "" : short]
    }))

    // The tooltip says the month in full, and marks the one still filling up
    const titles = new Map(months.map((month) => {
        const title = f.dateTime(midMonth(month.year, month.month), { month: "long", year: "numeric" })

        return [month.key, month.partial ? `${title} · ${t("to-date")}` : title]
    }))

    const points = months.map((month) => ({
        // Not "key": recharts spreads a row onto its rectangle and passes
        // anything SVG-shaped straight through, and React would read a field
        // called `key` as the element's key
        stamp: month.key,
        national: month.trips.national,
        regional: month.trips.regional,
        deliveries: month.deliveries,
        // recharts spreads a row's own props onto the rectangle it draws,
        // which is how the month still filling up comes out half-strength
        // without a <Cell> the UI package does not re-export
        ...(month.partial && { fillOpacity: 0.5 }),
    }))

    const total = months.reduce((sum, month) => sum + month.trips.total, 0)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("trips.title")}</h2>

            {total === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("trips.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        {/* The month key is the axis category — unique across
                            the years, so the blanked-out ticks cannot collide */}
                        <XAxis
                            dataKey="stamp"
                            interval={0}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11 }}
                            tickMargin={8}
                            tickFormatter={(value: string) => axis.get(value) ?? ""}
                        />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} />

                        {/* `includeHidden` is what carries the deliveries row
                            into the tooltip: recharts drops a hidden series
                            from the payload unless it is asked not to */}
                        <ChartTooltip
                            includeHidden
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
                                                {typeof value === "number" ? f.number(value) : String(value ?? "")}
                                            </span>
                                        </>
                                    )}
                                />
                            }
                        />
                        {/* recharts sorts legend items by data key unless told
                            not to; the stack order is the one that reads */}
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        <Bar dataKey="national" stackId="trips" fill="var(--color-national)" />
                        <Bar dataKey="regional" stackId="trips" fill="var(--color-regional)" radius={[4, 4, 0, 0]} />

                        {/* Hidden, and only for the tooltip: a bar that is
                            `hide` keeps its tooltip row but takes no column
                            width and no place on the scale, and `legendType`
                            keeps it out of the legend, where it would read as
                            a series that failed to draw */}
                        <Bar dataKey="deliveries" hide legendType="none" fill="var(--color-deliveries)" />
                    </BarChart>
                </ChartContainer>
            )}
        </section>
    )
}
