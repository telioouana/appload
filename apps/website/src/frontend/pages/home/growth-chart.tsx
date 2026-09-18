"use client"

import { Bar, BarChart, XAxis } from "recharts"

import { useTranslations } from "@workspace/i18n"
import { ChartContainer, type ChartConfig } from "@workspace/ui/components/chart"

import type { QuarterPoint } from "@/lib/metrics"

/**
 * A growth silhouette, not a data chart: bars are relative (indexed in
 * metrics.ts) and there's deliberately no tooltip or axis — absolute
 * volumes never reach the page.
 */
export function GrowthChart({ data }: { data: QuarterPoint[] }) {
    const t = useTranslations("metrics")

    const config = {
        index: {
            label: t("chart_title"),
            color: "var(--chart-2)",
        },
    } satisfies ChartConfig

    return (
        <ChartContainer
            config={config}
            className="h-44 w-full sm:h-52"
            initialDimension={{ width: 640, height: 176 }}
        >
            <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    tick={{ fill: "var(--canvas-faint)", fontSize: 11 }}
                    tickMargin={8}
                />
                <Bar dataKey="index" fill="var(--color-index)" radius={[5, 5, 0, 0]} maxBarSize={42} />
            </BarChart>
        </ChartContainer>
    )
}
