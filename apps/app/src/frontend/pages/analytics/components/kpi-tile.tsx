"use client"

import type { Icon as TablerIcon } from "@tabler/icons-react"

/**
 * One figure on the report: what it measures, how much of it the period
 * holds, and the one line under it that says what the number rests on.
 *
 * There is no list behind an average or a rate, so this is the list pages'
 * tile surface as a plain `div` — nothing to hover, nothing to press. The
 * value arrives already formatted: a rate, a count and a duration print
 * differently and only the caller knows which this is.
 */
export function KpiTile({
    Icon,
    label,
    value,
    hint,
}: {
    Icon: TablerIcon
    label: string
    /** Formatted by the caller — a percentage and a count want different digits */
    value: string
    hint?: string
}) {
    return (
        <div className="bg-card ring-foreground/5 dark:ring-foreground/10 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1">
            <span className="bg-muted text-muted-foreground hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex">
                <Icon className="size-4" stroke={1.5} />
            </span>

            <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-xs font-medium sm:truncate">{label}</span>

                <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">{value}</span>

                {hint && <span className="text-muted-foreground text-xs sm:truncate">{hint}</span>}
            </span>
        </div>
    )
}
