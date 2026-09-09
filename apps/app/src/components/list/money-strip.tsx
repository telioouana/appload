"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { moneyTone, type MoneyTone } from "@/components/list/money-tone"
import { useListParams } from "@/components/list/use-list-params"

export type MoneyMetric = {
    /** The key into each line's `values` */
    key: string
    label: string
    kind: "count" | "amount"
    /** URL params a click applies; the column is a plain figure without it */
    filter?: { key: string; value: string }[]
    /** How the figure reads: see `moneyTone`, which the dashboard shares */
    tone?: MoneyTone
    /** The bottom line, weighted so it reads first */
    emphasis?: boolean
}

/** The currency gutter, and the floor a metric column keeps before the strip scrolls */
const CURRENCY_COLUMN = 56
const METRIC_COLUMN = 130

export type MoneyLine = {
    currency: string
    values: Record<string, number>
}

/**
 * A money summary above a list: one column per metric, one row per
 * currency, never a grand total across currencies. Where a metric carries
 * a filter its header is a button that opens exactly the rows it counts;
 * the metrics are exclusive among themselves, like the attention tiles.
 * `control` sits in the title row for a switch that changes the scope.
 */
export function MoneyStrip({
    title,
    metrics,
    lines,
    control,
    reset = [],
    empty,
}: {
    title: string
    metrics: MoneyMetric[]
    lines: MoneyLine[]
    control?: React.ReactNode
    /** Extra URL params a metric click clears, e.g. the status tab */
    reset?: string[]
    /** Shown instead of the grid when there is nothing to move */
    empty: string
}) {
    const t = useTranslations("App.list")
    const f = useFormatter()
    const { get, set } = useListParams()

    const isActive = (metric: MoneyMetric) =>
        metric.filter !== undefined && metric.filter.every((pair) => get(pair.key) === pair.value)

    const toggle = (metric: MoneyMetric) => {
        if (!metric.filter) return
        const active = isActive(metric)
        const cleared = new Set([...reset, ...metrics.flatMap((other) => other.filter?.map((pair) => pair.key) ?? [])])

        set([
            ...[...cleared].map((key) => ({ key, value: null })),
            ...(active ? [] : metric.filter),
            { key: "page", value: null },
        ])
    }

    const format = (metric: MoneyMetric, value: number) =>
        metric.kind === "count"
            ? f.number(value)
            : f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 mx-2 rounded-2xl px-4 py-3 ring-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 className="text-sm font-medium">{title}</h2>
                {control}
            </div>

            {lines.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">{empty}</p>
            ) : (
                <div className="container-snap mt-2 overflow-x-auto">
                    {/* Fixed layout so every metric column is the same width
                        whatever it holds; the min-width scales with how many
                        there are, and the wrapper scrolls below it */}
                    <table
                        className="w-full table-fixed border-separate border-spacing-0 text-sm"
                        style={{ minWidth: `${CURRENCY_COLUMN + metrics.length * METRIC_COLUMN}px` }}
                    >
                        <thead>
                            <tr>
                                <th scope="col" className="pb-2 text-left align-bottom" style={{ width: CURRENCY_COLUMN }}>
                                    <span className="sr-only">{t("currency")}</span>
                                </th>
                                {metrics.map((metric) => {
                                    const active = isActive(metric)
                                    const body = (
                                        <span className={cn("text-xs font-medium", active ? "text-primary" : "text-muted-foreground")}>{metric.label}</span>
                                    )

                                    return (
                                        <th
                                            key={metric.key}
                                            scope="col"
                                            className={cn("pb-2 pl-3 text-right align-bottom", metric.emphasis && "rounded-t-xl pr-2")}
                                        >
                                            {metric.filter ? (
                                                <button
                                                    type="button"
                                                    aria-pressed={active}
                                                    onClick={() => toggle(metric)}
                                                    className={cn(
                                                        "hover:text-foreground -mr-2 cursor-pointer rounded-lg px-2 py-1 text-right transition-colors",
                                                        active && "bg-primary/10",
                                                    )}
                                                >
                                                    {body}
                                                </button>
                                            ) : body}
                                        </th>
                                    )
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line) => (
                                <tr key={line.currency}>
                                    <th scope="row" className="text-muted-foreground border-t py-3.5 text-left text-xs font-medium">
                                        {line.currency}
                                    </th>
                                    {metrics.map((metric) => {
                                        const value = line.values[metric.key] ?? 0

                                        return (
                                            <td
                                                key={metric.key}
                                                className={cn(
                                                    "border-t py-3.5 pl-3 text-right tabular-nums",
                                                    metric.emphasis && "pr-2 font-semibold",
                                                    moneyTone(metric.tone, value),
                                                )}
                                            >
                                                {format(metric, value)}
                                            </td>
                                        )
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
