"use client"

import type { Icon as TablerIcon } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { moneyTone } from "@/components/list/money-tone"

/**
 * One figure on the metrics page's top row: what it measures, how much of it
 * the year has so far, and how that compares with the same stretch of last
 * year.
 *
 * The dashboard's `KpiTile` is a link to the list it counted; there is no
 * list behind a year of revenue, so this is that surface as a plain `div` —
 * nothing to hover, nothing to press. The value arrives already formatted:
 * money and counts print differently and only the caller knows which this is.
 */
export function MetricTile({
    Icon,
    label,
    value,
    hint,
    delta,
}: {
    Icon: TablerIcon
    label: string
    /** Formatted by the caller — a count and a sum of dollars want different digits */
    value: string
    /** The period `delta` is measured against ("Jan–Sep 2025"), or a plain line of context when there is no delta */
    hint?: string
    /** The change against that period as a fraction; null when there is no earlier period to compare with */
    delta?: number | null
}) {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()

    // A tenth of a percent on a year of revenue is noise, so the digits go;
    // the sign is the point, and it is shown even when nothing moved
    const change =
        typeof delta === "number"
            ? f.number(delta, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" })
            : null

    return (
        <div className="bg-card ring-foreground/5 dark:ring-foreground/10 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1">
            <span className="bg-muted text-muted-foreground hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex">
                <Icon className="size-4" stroke={1.5} />
            </span>

            <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-xs font-medium sm:truncate">{label}</span>

                <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">{value}</span>

                {hint && (
                    <span className={cn(
                        "text-xs sm:truncate",
                        // The whole line carries the tone: the change reads as
                        // part of the period it belongs to, not as a badge
                        typeof delta === "number" ? moneyTone("signed", delta) : "text-muted-foreground",
                    )}>
                        {change === null ? hint : t("tiles.vs-last-year", { period: hint, change })}
                    </span>
                )}
            </span>
        </div>
    )
}
