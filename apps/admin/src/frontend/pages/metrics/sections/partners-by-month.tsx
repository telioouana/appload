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
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"

import { useTRPC } from "@/backend/api/client"
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * How many shippers and carriers Appload worked with each month — the width
 * of the book, next to the trips card that shows what the book carried. A
 * month that lifts its trips without lifting either line is the same few
 * clients loading more, which is a different business from growing.
 *
 * Lines, not columns: these are counts of the same parties month after month,
 * so what matters is the level and its drift, not the size of one month.
 * Each count is unique *within* its month — the sheet counts a client once
 * however many loads it sent — so the numbers never add up across months.
 */
export function PartnersByMonth() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const months = data.months

    // Status tokens rather than the --chart-* ramp, which the money cards
    // took: two lines are categorical, and this pair holds apart under every
    // kind of colour blindness on both the light and the dark card.
    const config = {
        shippers: { label: t("partners.series.shippers"), color: "var(--status-loading-text)" },
        carriers: { label: t("partners.series.carriers"), color: "var(--status-delivered-text)" },
    } satisfies ChartConfig

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const midMonth = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15))

    // Past two years there is no room for twelve labels a year, so only the
    // ticks that open a year keep their text — the same axis the other bands
    // draw, so the whole page reads as one timeline
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
        stamp: month.key,
        shippers: month.shippers,
        carriers: month.carriers,
    }))

    const total = months.reduce((sum, month) => sum + month.shippers + month.carriers, 0)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("partners.title")}</h2>

            {total === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("partners.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                                                {typeof value === "number" ? f.number(value) : String(value ?? "")}
                                            </span>
                                        </>
                                    )}
                                />
                            }
                        />
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        {/* No dots: fifty-odd months of them would be a second
                            texture over the line and say nothing the line does
                            not already say */}
                        <Line
                            type="monotone"
                            dataKey="shippers"
                            stroke="var(--color-shippers)"
                            strokeWidth={2}
                            dot={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="carriers"
                            stroke="var(--color-carriers)"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ChartContainer>
            )}

            {/* Said out loud because the chart cannot: two months of five
                shippers may be the same five, and the card must not be read
                as ten */}
            <p className="text-muted-foreground text-xs">{t("partners.note")}</p>
        </section>
    )
}
