"use client"

import { IconMap, IconTable, type Icon } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import type { MapViewMode } from "@/frontend/pages/map/hooks/use-map-selection"

const VIEWS: { value: MapViewMode; icon: Icon }[] = [
    { value: "map", icon: IconMap },
    { value: "table", icon: IconTable },
]

/**
 * Map or table, the fleet pages' pill under the title. Buttons rather than
 * links: the two views are one page reading one query, and the choice is a
 * shallow `?view=` so switching never re-runs the server.
 */
export function MapViewSwitch({ view, onChange }: { view: MapViewMode; onChange: (view: MapViewMode) => void }) {
    const t = useTranslations("App.map.views")

    return (
        <div className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
            {VIEWS.map(({ value, icon: Icon }) => {
                const active = value === view

                return (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(value)}
                        className={cn(
                            "text-muted-foreground flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                            active && "bg-background text-foreground font-medium shadow-sm",
                        )}
                    >
                        <Icon className="size-3.5" stroke={1.5} />
                        {t(value)}
                    </button>
                )
            })}
        </div>
    )
}
