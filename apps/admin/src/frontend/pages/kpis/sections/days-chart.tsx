"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@workspace/ui/components/chart"
import { Bar, BarChart, LabelList, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"

import { useTRPC } from "@/backend/api/client"
import { reportInput } from "@/frontend/pages/kpis/types"

/** The four stages of a trip, in the order it lives through them. */
type Stage = "loading" | "travelling" | "border" | "offloading"

/**
 * Where a transport's days actually go: waiting to load, on the road, at the
 * border, waiting to offload. Bars run across rather than up because the four
 * things being compared are named stages, and a name reads better beside its
 * bar than under it.
 *
 * Each average is over the trips that recorded that stage, not over all of
 * them — a duration nobody filled in is missing, not zero — so the tooltip
 * carries the sample it was taken from. The border row is over regional trips
 * only, the only ones with a border to sit at.
 */
export function DaysChart() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const kpis = report.kpis

    // One measure, so one colour and no legend: the axis names every row
    const config = {
        days: { label: t("charts.days.days"), theme: { light: "var(--chart-4)", dark: "var(--chart-2)" } },
    } satisfies ChartConfig

    const stageLabel: Record<Stage, string> = {
        loading: t("charts.days.loading"),
        travelling: t("charts.days.travelling"),
        border: t("charts.days.border"),
        offloading: t("charts.days.offloading"),
    }

    const rows = [
        { stage: "loading" as const, days: kpis.avgLoadingDays, trips: kpis.loadingDaysTrips, total: kpis.transports },
        { stage: "travelling" as const, days: kpis.avgTravelDays, trips: kpis.travelDaysTrips, total: kpis.transports },
        { stage: "border" as const, days: kpis.avgBorderDays, trips: kpis.borderDaysTrips, total: kpis.regionalTrips },
        {
            stage: "offloading" as const,
            days: kpis.avgOffloadingDays,
            trips: kpis.offloadingDaysTrips,
            total: kpis.transports,
        },
    ]

    const points = rows.map((row) => {
        const sample = t("charts.days.sample", { count: row.trips, total: row.total })

        return {
            stage: row.stage,
            // A stage nobody timed draws no bar and says so in its label,
            // rather than claiming a trip spent no days there
            days: row.days ?? 0,
            label: row.days === null ? "—" : f.number(row.days, { maximumFractionDigits: 1 }),
            sample: row.stage === "border" ? `${sample} · ${t("charts.days.regional")}` : sample,
        }
    })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("charts.days.title")}</h2>

            {rows.every((row) => row.trips === 0) ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("charts.days.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 420, height: 260 }}
                >
                    {/* Room on the right for the value that rides at the tip
                        of the longest bar; no grid, because the number is
                        already written where the bar ends */}
                    <BarChart data={points} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
                        <XAxis type="number" hide />
                        <YAxis
                            type="category"
                            dataKey="stage"
                            width={96}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: string) => stageLabel[value as Stage]}
                        />

                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(label) => stageLabel[String(label) as Stage] ?? String(label)}
                                    formatter={(_value, _name, item) => {
                                        const point = item.payload as (typeof points)[number] | undefined

                                        return (
                                            <>
                                                <span
                                                    className="size-2.5 shrink-0 rounded-[2px]"
                                                    style={{ backgroundColor: item.color }}
                                                />
                                                <span className="text-muted-foreground flex-1">
                                                    {t("charts.days.days")}
                                                </span>
                                                <span className="text-foreground font-mono font-medium tabular-nums">
                                                    {point?.label ?? ""}
                                                </span>
                                                {/* Full width, so the sample the
                                                    average was taken from gets a
                                                    line of its own */}
                                                <span className="text-muted-foreground w-full text-[11px]">
                                                    {point?.sample ?? ""}
                                                </span>
                                            </>
                                        )
                                    }}
                                />
                            }
                        />

                        <Bar dataKey="days" fill="var(--color-days)" radius={[0, 4, 4, 0]} maxBarSize={18}>
                            <LabelList dataKey="label" position="right" className="fill-foreground text-xs" />
                        </Bar>
                    </BarChart>
                </ChartContainer>
            )}
        </section>
    )
}
