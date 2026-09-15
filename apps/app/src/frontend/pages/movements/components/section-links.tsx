"use client"

import type { Icon } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { tabOfScope, type MovementScope, type MovementSection, type MovementStatus, type OrgType } from "@/frontend/pages/movements/types"

/**
 * What a tab is called, under `App.loads.tabs`: My trucks for everyone, and
 * the other side named for what it is to this company — a client's partners
 * are its transporters, a transporter's are its partners.
 */
export const tabLabelKey = (scope: MovementScope, orgType: OrgType): "own" | "transporters" | "partners" =>
    scope === "trips" ? "own" : orgType === "carrier" ? "partners" : "transporters"

/** The typed link to one section of the Orders page, on one of its two tabs. */
export const sectionHref = (scope: MovementScope, section: MovementSection) =>
    ({ pathname: "/orders/[section]" as const, params: { section }, query: { tab: tabOfScope(scope) } })

export type SectionTile = {
    section: MovementSection
    /** The silent-drivers tile: the in-progress section, narrowed to who has not answered today */
    silent?: true
    /** A tile for one status tab of the section, opened with that tab selected */
    status?: MovementStatus
    label: string
    value: number
    hint?: string
    Icon: Icon
}

/**
 * The work queue above the table. A section IS the filter on these pages, so
 * each tile is a link to one — or to one status tab of one — on the tab on
 * screen, and the count it shows is the count the page it opens will hold,
 * both read from the same stats. The one exception is the transporter's
 * offers tile, which counts the offers it must answer and opens on a tab that
 * lists its own quotes too: a tile may open on more than it counted, never
 * on less.
 */
export function SectionTiles({
    scope,
    section,
    silent,
    status,
    tiles,
}: {
    scope: MovementScope
    /** The section on screen, so the tile that opens it reads as current */
    section: MovementSection
    /** Whether the silent filter is on, which the silent tile also depends on */
    silent: boolean
    /** The status tab on screen, which a status tile also depends on */
    status: string | null
    tiles: SectionTile[]
}) {
    return (
        <div className={cn("grid grid-cols-2 gap-3 px-2", tiles.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
            {tiles.map((tile) => {
                const active = tile.section === section && Boolean(tile.silent) === silent && (tile.status ?? null) === status
                const href = sectionHref(scope, tile.section)

                return (
                    <Link
                        key={`${tile.section}${tile.silent ? "-silent" : ""}${tile.status ? `-${tile.status}` : ""}`}
                        href={{
                            ...href,
                            query: { ...href.query, ...(tile.silent && { silent: "1" }), ...(tile.status && { status: tile.status }) },
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
