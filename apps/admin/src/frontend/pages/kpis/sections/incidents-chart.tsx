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

/** What can stop a truck, in the order the KPI sheet lists it. */
type Kind = "accidents" | "mechanical" | "documentation" | "police"

/**
 * What went wrong on the road. Four counts, one hue — these are not four
 * things being compared for identity but one bad thing counted four ways, so
 * they wear the amber the admin already uses for a trip that stopped.
 *
 * The occurrences are on the bars and the days they cost are in the tooltip:
 * a police stop and a breakdown are both one incident, and only the delay says
 * which of them actually hurt. An accident has no delay column of its own,
 * so it carries none.
 */
export function IncidentsChart() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const kpis = report.kpis

    // One measure, so one colour and no legend: the axis names every row.
    // The status token, not the --chart-* ramp — this is the admin's "a trip
    // stopped" amber, and both themes define it.
    const config = {
        incidents: { label: t("charts.incidents.count"), color: "var(--status-stopped-text)" },
    } satisfies ChartConfig

    const kindLabel: Record<Kind, string> = {
        accidents: t("charts.incidents.accidents"),
        mechanical: t("charts.incidents.mechanical"),
        documentation: t("charts.incidents.documentation"),
        police: t("charts.incidents.police"),
    }

    const rows = [
        { kind: "accidents" as const, count: kpis.accidents, delay: null },
        { kind: "mechanical" as const, count: kpis.mechanical, delay: kpis.mechanicalDelayDays },
        { kind: "documentation" as const, count: kpis.documentation, delay: kpis.documentationDelayDays },
        { kind: "police" as const, count: kpis.police, delay: kpis.policeDelayDays },
    ]

    const points = rows.map((row) => ({
        kind: row.kind,
        incidents: row.count,
        label: f.number(row.count),
        // Only a delay that actually cost days is worth a line
        delay: row.delay && row.delay > 0 ? t("charts.incidents.delay", { days: row.delay }) : "",
    }))

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("charts.incidents.title")}</h2>

            {rows.every((row) => row.count === 0) ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("charts.incidents.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 420, height: 260 }}
                >
                    {/* Room on the right for the count that rides at the tip
                        of the longest bar; no grid, because the number is
                        already written where the bar ends */}
                    <BarChart data={points} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
                        <XAxis type="number" allowDecimals={false} hide />
                        {/* Sized to its ticks: "Documentation issues" is half
                            again as long in Portuguese */}
                        <YAxis
                            type="category"
                            dataKey="kind"
                            width="auto"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: string) => kindLabel[value as Kind]}
                        />

                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(label) => kindLabel[String(label) as Kind] ?? String(label)}
                                    formatter={(_value, _name, item) => {
                                        const point = item.payload as (typeof points)[number] | undefined

                                        return (
                                            <>
                                                <span
                                                    className="size-2.5 shrink-0 rounded-[2px]"
                                                    style={{ backgroundColor: item.color }}
                                                />
                                                <span className="text-muted-foreground flex-1">
                                                    {t("charts.incidents.count")}
                                                </span>
                                                <span className="text-foreground font-mono font-medium tabular-nums">
                                                    {point?.label ?? ""}
                                                </span>
                                                {/* Full width, so the days the
                                                    stops cost get a line of
                                                    their own */}
                                                {point?.delay ? (
                                                    <span className="text-muted-foreground w-full text-[11px]">
                                                        {point.delay}
                                                    </span>
                                                ) : null}
                                            </>
                                        )
                                    }}
                                />
                            }
                        />

                        <Bar dataKey="incidents" fill="var(--color-incidents)" radius={[0, 4, 4, 0]} maxBarSize={18}>
                            <LabelList dataKey="label" position="right" className="fill-foreground text-xs" />
                        </Bar>
                    </BarChart>
                </ChartContainer>
            )}
        </section>
    )
}
