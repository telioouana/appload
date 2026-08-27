"use client"

import { Bar, BarChart, XAxis } from "recharts"

import { useTranslations } from "@workspace/i18n"
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@workspace/ui/components/chart"

import type { QuarterPoint } from "@/lib/metrics"

export function GrowthChart({ data }: { data: QuarterPoint[] }) {
    const t = useTranslations("metrics")

    const config = {
        tons: {
            label: t("chart_tons"),
            color: "var(--chart-2)",
        },
        loads: {
            label: t("chart_loads"),
            color: "var(--chart-4)",
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
                <ChartTooltip cursor={{ fill: "rgb(255 255 255 / 0.04)" }} content={<ChartTooltipContent />} />
                <Bar dataKey="tons" fill="var(--color-tons)" radius={[5, 5, 0, 0]} maxBarSize={42} />
            </BarChart>
        </ChartContainer>
    )
}
