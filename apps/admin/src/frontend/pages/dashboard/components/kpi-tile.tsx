"use client"

import type { Icon as TablerIcon } from "@tabler/icons-react"

import { useFormatter } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"

/**
 * One figure on the dashboard's top row: what it counts, how many, and the
 * one fact underneath saying whether it needs a hand today. The whole tile is
 * a link to the list it counted, so the number and the page it opens can
 * never disagree.
 *
 * Same surface as the list pages' `AttentionTiles` minus their toggle — a
 * tile here opens another page instead of filtering the one you stand on, so
 * it has no pressed state to carry. On a phone the icon chip goes and the
 * label and hint wrap instead of truncating: two tiles to a row leave no
 * width for a chip and a full sentence.
 */
export function KpiTile({
    href,
    Icon,
    label,
    value,
    hint,
    tone,
}: {
    href: React.ComponentProps<typeof Link>["href"]
    Icon: TablerIcon
    label: string
    value: number
    hint?: string
    /** "warn" when the hint reports something overdue, silent or due now */
    tone?: "warn"
}) {
    const f = useFormatter()

    return (
        <Link
            href={href}
            className={cn(
                "bg-card ring-foreground/5 dark:ring-foreground/10 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-colors",
                "hover:ring-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
            )}
        >
            <span className="bg-muted text-muted-foreground hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex">
                <Icon className="size-4" stroke={1.5} />
            </span>

            <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-xs font-medium sm:truncate">{label}</span>

                <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                    {f.number(value)}
                </span>

                {hint && (
                    <span className={cn(
                        "text-xs sm:truncate",
                        tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                    )}>
                        {hint}
                    </span>
                )}
            </span>
        </Link>
    )
}
