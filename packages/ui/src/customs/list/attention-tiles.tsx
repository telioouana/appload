"use client"

import type { Icon } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

export type AttentionTile = {
    /** The URL filter this tile applies; the key is also the tile's identity */
    filter: { key: string; value: string }
    label: string
    value: number
    /** One short line under the number saying why it needs attention */
    hint?: string
    Icon: Icon
}

/**
 * The work queue above the table: each tile counts the rows that need a
 * hand (documents to review, expiring paperwork, incomplete profiles…) and
 * clicking it filters the list to exactly those rows. The tiles are
 * orthogonal to the status tabs, so one of each can be active at once and
 * they never disagree about a number.
 *
 * Tiles are exclusive among themselves: picking one clears the others and
 * the page, so the count shown is always the count opened. A page whose
 * tabs would narrow a tile's count (the orders sections) passes those
 * params in `reset` so the tile always opens exactly what it counted.
 */
export function AttentionTiles({ tiles, reset = [] }: { tiles: AttentionTile[]; reset?: string[] }) {
    const { get, set } = useListParams()

    const isActive = (tile: AttentionTile) => get(tile.filter.key) === tile.filter.value

    const toggle = (tile: AttentionTile) => {
        const active = isActive(tile)

        // Only a tile that is currently on gets switched off; a status tab
        // that happens to share a key with a tile is left alone
        set([
            ...tiles
                .filter((other) => other !== tile && isActive(other))
                .map(({ filter }) => ({ key: filter.key, value: null })),
            ...reset.map((key) => ({ key, value: null })),
            { key: tile.filter.key, value: active ? null : tile.filter.value },
            { key: "page", value: null },
        ])
    }

    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            {tiles.map((tile) => {
                const active = isActive(tile)

                return (
                    <button
                        // Two tiles may share a param and differ by value (the
                        // partners page's incoming/outgoing requests), so the
                        // identity is the pair
                        key={`${tile.filter.key}=${tile.filter.value}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(tile)}
                        className={cn(
                            "bg-card ring-foreground/5 flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-colors",
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
                    </button>
                )
            })}
        </div>
    )
}
