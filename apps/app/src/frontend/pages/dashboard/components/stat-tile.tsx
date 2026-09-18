"use client"

import type { Icon as TablerIcon } from "@tabler/icons-react"

import { useFormatter } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"

export type StatTileProps = {
    Icon: TablerIcon
    label: string
    value: number
    /** One short line under the number saying what it is asking for */
    hint?: string
    /**
     * The list the number opens. Absent for a figure no page reproduces — a
     * carrier's whole visible world has no list of its own, and a tile that
     * lands somewhere counting something else would be worse than a tile that
     * does not move.
     */
    href?: React.ComponentProps<typeof Link>["href"]
}

const SURFACE = "bg-card ring-foreground/5 dark:ring-foreground/10 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1"

const DOOR = "transition-colors hover:ring-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-3"

/**
 * One figure on the board's top row: what it counts, how many, and the one
 * line underneath saying whether it needs a hand today.
 *
 * Same surface as the list pages' `AttentionTiles` minus their toggle — a
 * tile here opens another page instead of filtering the one you stand on, so
 * it has no pressed state to carry. On a phone the icon chip goes and the
 * label and hint wrap instead of truncating: two tiles to a row leave no
 * width for a chip and a full sentence.
 */
export function StatTile({ Icon, label, value, hint, href }: StatTileProps) {
    const f = useFormatter()

    const body = (
        <>
            <span className="bg-muted text-muted-foreground hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex">
                <Icon className="size-4" stroke={1.5} />
            </span>

            <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-xs font-medium sm:truncate">{label}</span>

                <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                    {f.number(value)}
                </span>

                {hint && <span className="text-muted-foreground text-xs sm:truncate">{hint}</span>}
            </span>
        </>
    )

    if (!href) return <div className={SURFACE}>{body}</div>

    return <Link href={href} className={cn(SURFACE, DOOR)}>{body}</Link>
}
