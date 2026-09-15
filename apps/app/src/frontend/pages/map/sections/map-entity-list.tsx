"use client"

import { useMemo } from "react"
import { IconBox, IconRoute } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Separator } from "@workspace/ui/components/separator"

import { cn } from "@workspace/ui/lib/utils"

import { OrderStatusBadge } from "@/frontend/pages/orders/components/badges"
import { place } from "@/frontend/pages/orders/lib/format"
import { MapSearchInput } from "@/frontend/pages/map/components/map-search-input"
import type { MapEntity } from "@/frontend/pages/map/types"

/** Newest ping first; movements that have never pinged sink to the bottom. */
const seenAt = (entity: MapEntity) => entity.lastPosition?.recordedAt.getTime() ?? 0

/**
 * The map's index: everything on the road, always all of it. A search never
 * removes a row — it pushes the matches to the top and fades the rest, so the
 * whole fleet stays in view while one truck is being hunted for.
 */
export function MapEntityList({
    entities,
    matches,
    query,
    onQueryChange,
    selected,
    onSelect,
    className,
}: {
    entities: MapEntity[]
    matches: Set<string>
    query: string
    onQueryChange: (value: string) => void
    selected: string | null
    onSelect: (ref: string) => void
    className?: string
}) {
    const t = useTranslations("App.map")
    const f = useFormatter()
    // Explicit now keeps relativeTime warning-free and ticks the labels over
    const now = useNow({ updateInterval: 60_000 })

    const sorted = useMemo(() => {
        const missed = (entity: MapEntity) => (query && !matches.has(entity.ref) ? 1 : 0)

        return [...entities].sort((a, b) => missed(a) - missed(b) || seenAt(b) - seenAt(a))
    }, [entities, matches, query])

    return (
        <aside className={cn("bg-card flex w-80 shrink-0 flex-col border-r", className)}>
            <div className="flex flex-col gap-2 p-3">
                <MapSearchInput query={query} onQueryChange={onQueryChange} />

                <p className="text-muted-foreground text-xs">
                    {query ? t("matches", { count: matches.size }) : t("count", { count: entities.length })}
                </p>
            </div>

            <Separator />

            <div className="container-snap flex-1 overflow-y-auto">
                {sorted.map((entity) => {
                    const isSelected = entity.ref === selected
                    const isDimmed = !!query && !matches.has(entity.ref)
                    // An order and a load read alike otherwise; the mark says
                    // which page the row leads to
                    const KindIcon = entity.kind === "load" ? IconRoute : IconBox

                    return (
                        <button
                            key={entity.ref}
                            type="button"
                            onClick={() => onSelect(entity.ref)}
                            className={cn(
                                "hover:bg-muted/60 flex w-full cursor-pointer flex-col gap-1 border-l-2 border-transparent px-3 py-2.5 text-left transition-colors",
                                isSelected && "border-primary bg-accent/10",
                                isDimmed && "opacity-50",
                            )}
                        >
                            <span className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <KindIcon className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
                                    <span className="truncate text-sm font-medium">{entity.ref}</span>
                                </span>
                                <OrderStatusBadge status={entity.status} className="shrink-0 px-1.5 py-0.5 text-xs" />
                            </span>

                            <span className="text-muted-foreground truncate text-xs">
                                {[entity.driverName, entity.truckPlate].filter(Boolean).join(" · ") || "—"}
                            </span>

                            <span className="text-muted-foreground truncate text-[11px]">
                                {place(entity.origin)} → {place(entity.destination)}
                            </span>

                            <span className="text-muted-foreground text-[11px]">
                                {entity.lastPosition
                                    ? t("list.last-seen", { ago: f.relativeTime(entity.lastPosition.recordedAt, now) })
                                    : t("list.no-location")}
                            </span>
                        </button>
                    )
                })}
            </div>
        </aside>
    )
}
