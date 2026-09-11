"use client"

import type { Icon } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Scroller } from "@workspace/ui/customs/list/scroller"

import { Link } from "@/i18n/navigation"
import { sectionsOf, type MovementScope, type MovementSection, type MovementStats } from "@/frontend/pages/movements/types"

/** The typed link to one section of one of the two lists. */
export const sectionHref = (scope: MovementScope, section: MovementSection) =>
    scope === "orders"
        ? { pathname: "/orders/[section]" as const, params: { section } }
        : { pathname: "/trips/[section]" as const, params: { section } }

/**
 * The sections, as tabs. They are routes rather than a URL filter — each is
 * addressable, and a shared link opens the list the sender meant — so these
 * are links, and following one starts the section clean instead of carrying
 * the previous page's search into it.
 */
export function SectionLinks({
    scope,
    section,
    stats,
}: {
    scope: MovementScope
    section: MovementSection
    stats: MovementStats | undefined
}) {
    const t = useTranslations("App.loads.sections")

    return (
        // The strip sits on the page ground rather than on a card, so the
        // scroll fades are painted in that colour instead of the card's
        <Scroller axis="x" className="mt-2" fadeClassName="from-background to-background/0">
            <div role="tablist" className="flex w-max gap-0.5">
                {sectionsOf(scope).map((value) => {
                    const active = value === section
                    const count = stats?.bySection[value]

                    return (
                        <Link
                            key={value}
                            role="tab"
                            aria-selected={active}
                            href={sectionHref(scope, value)}
                            className={cn(
                                "text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors",
                                active && "bg-primary/10 text-primary font-medium",
                            )}
                        >
                            {t(value)}
                            {count !== undefined && (
                                <span className={cn(
                                    "bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                    active && "bg-primary/15 text-primary",
                                )}>
                                    {count.toLocaleString()}
                                </span>
                            )}
                        </Link>
                    )
                })}
            </div>
        </Scroller>
    )
}

export type SectionTile = {
    section: MovementSection
    /** The silent-drivers tile: the on-the-road section, narrowed to who has not answered today */
    silent?: true
    label: string
    value: number
    hint?: string
    Icon: Icon
}

/**
 * The work queue above the table. A section IS the filter on these pages, so
 * each tile is a link to one, and the count it shows is the count the page
 * it opens will hold — both read the same stats.
 */
export function SectionTiles({
    scope,
    section,
    silent,
    tiles,
}: {
    scope: MovementScope
    /** The section on screen, so the tile that opens it reads as current */
    section: MovementSection
    /** Whether the silent filter is on, which the silent tile also depends on */
    silent: boolean
    tiles: SectionTile[]
}) {
    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            {tiles.map((tile) => {
                const active = tile.section === section && Boolean(tile.silent) === silent

                return (
                    <Link
                        key={`${tile.section}${tile.silent ? "-silent" : ""}`}
                        href={{ ...sectionHref(scope, tile.section), query: tile.silent ? { silent: "1" } : undefined }}
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
