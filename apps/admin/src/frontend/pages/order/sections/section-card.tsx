"use client"

import { cn } from "@workspace/ui/lib/utils"

/**
 * A block on the order page. Same ring-and-radius surface as the list card
 * and the partner profile cards, so the page reads as part of the same
 * system: a small title, an optional count, something on the right, then the
 * content.
 */
export function SectionCard({
    title,
    count,
    aside,
    actions,
    className,
    children,
}: {
    title: string
    count?: number
    aside?: React.ReactNode
    actions?: React.ReactNode
    className?: string
    children: React.ReactNode
}) {
    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <header className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-medium">
                    {title}
                    {count !== undefined && (
                        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums">
                            {count}
                        </span>
                    )}
                </h2>

                {actions ?? (aside && <div className="text-muted-foreground flex items-center gap-1.5 text-xs">{aside}</div>)}
            </header>

            {children}
        </section>
    )
}

/** A figure with its caption, four to a row. */
export function StatTile({ value, label }: { value: React.ReactNode; label: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">{value}</span>
            <span className="text-muted-foreground text-xs">{label}</span>
        </div>
    )
}

/** Label left, value right — the page's label/value idiom. */
export function DetailRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 text-[13px]">
            <dt className="text-muted-foreground flex shrink-0 items-center gap-1.5">{label}</dt>
            <dd className="flex min-w-0 items-baseline justify-end gap-1.5 text-right tabular-nums">{children}</dd>
        </div>
    )
}

/**
 * The divider row under the trip strip and the totals under the parties:
 * cells separated by a rule, wrapping to two per line on a phone.
 *
 * Equal grid tracks rather than flex: a flex item with a zero basis treats
 * its own padding and border as a floor and only then splits what is left,
 * so the first cell — which has neither — came out narrower than the rest
 * and dragged every rule off the fractions they should sit on. The middle
 * one has to land on the card's centre line, where the rule between the two
 * parties above it sits.
 */
export function CellRow({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <div className={cn(
            "grid grid-cols-2 gap-y-3 border-t pt-3.5 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none sm:gap-y-0",
            "[&>*]:min-w-0 [&>*]:sm:border-l [&>*]:sm:px-5 [&>*:first-child]:sm:border-l-0 [&>*:first-child]:sm:pl-0",
            "[&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:pl-4 sm:[&>*:nth-child(even)]:pl-5",
            className,
        )}>
            {children}
        </div>
    )
}

/** One cell of a `CellRow`: a caption over a value. */
export function Cell({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">{label}</span>
            <span className="text-sm font-medium tabular-nums">{children}</span>
        </div>
    )
}
