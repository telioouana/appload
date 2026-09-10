"use client"

import type { Icon } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import type { OrderSection } from "@/frontend/pages/orders/types"

export type AttentionLink = {
    /** The section this tile opens, and — with the flag below — its identity */
    section: OrderSection
    /** Carrier's "to dispatch": booked orders with nobody driving them yet */
    dispatch?: true
    label: string
    value: number
    hint?: string
    Icon: Icon
}

/**
 * The work queue above the table: what is waiting on the tenant, and one
 * click to exactly those orders.
 *
 * The list kit's `AttentionTiles` writes a URL filter on the page it sits on;
 * these tiles cross pages, because a section IS the filter here — "offers to
 * review" is the quoted list, "on the road" the on-going one. So each tile is
 * a link, and the count it shows is the count the page it opens will hold.
 */
export function AttentionLinks({
    tiles,
    section,
    dispatch,
}: {
    tiles: AttentionLink[]
    /** The section on screen, so the tile that opens it reads as current */
    section: OrderSection
    /** Whether the dispatch filter is on, which the booked tile also depends on */
    dispatch: boolean
}) {
    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            {tiles.map((tile) => {
                const active = tile.section === section && Boolean(tile.dispatch) === dispatch

                return (
                    <Link
                        key={`${tile.section}${tile.dispatch ? "-dispatch" : ""}`}
                        href={{
                            pathname: "/orders/[section]",
                            params: { section: tile.section },
                            query: tile.dispatch ? { dispatch: "1" } : undefined,
                        }}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "bg-card ring-foreground/5 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-colors",
                            "hover:ring-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
                            active && "ring-primary bg-primary/5 hover:ring-primary",
                        )}
                    >
                        <span className={cn(
                            "bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl",
                            active && "bg-primary/12 text-primary",
                        )}>
                            <tile.Icon className="size-4" stroke={1.5} />
                        </span>

                        <span className="flex min-w-0 flex-col">
                            <span className="text-muted-foreground truncate text-xs font-medium">{tile.label}</span>
                            <span className={cn(
                                "text-xl leading-tight font-semibold tracking-tight tabular-nums",
                                active && "text-primary",
                            )}>
                                {tile.value.toLocaleString()}
                            </span>
                            {tile.hint && <span className="text-muted-foreground truncate text-xs">{tile.hint}</span>}
                        </span>
                    </Link>
                )
            })}
        </div>
    )
}
