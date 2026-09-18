"use client"

import { useMemo } from "react"

import { useTranslations } from "@workspace/i18n"

import { MapCanvas } from "@workspace/maps/components/map-canvas"
import { GoogleMapsProvider } from "@workspace/maps/components/maps-provider"

import { MapSelectedCard } from "@/frontend/pages/map/sections/map-selected-card"
import { OverviewPins } from "@/frontend/pages/map/sections/overview-pins"
import type { MapEntity } from "@/frontend/pages/map/types"

/**
 * What the company has on the road, as a block on the board: the same pins
 * and the same open-movement card as `/map`, minus everything that needs the
 * whole viewport — no search, no trail, no route layer. Gestures stay
 * "cooperative" (the canvas default) because the page scrolls behind this
 * card and a wheel over the map must scroll it, not zoom.
 *
 * This is the only file on the board allowed to import the Maps components;
 * everything else reaches it through `overview-map.lazy.tsx`, so the Maps
 * bundle never lands in the page's first paint.
 */

/** No search box here, so no pin is ever a "match" — one frozen set, stable across renders. */
const NO_MATCHES: Set<string> = new Set()

export function OverviewMap({
    entities,
    selected,
    onSelect,
    onClose,
}: {
    entities: MapEntity[]
    selected: string | null
    onSelect: (id: string) => void
    onClose: () => void
}) {
    const t = useTranslations("App.map.detail")

    const selectedEntity = useMemo(
        () => entities.find((entity) => entity.id === selected) ?? null,
        [entities, selected],
    )

    return (
        <div className="relative h-full">
            <GoogleMapsProvider missingKeyMessage={t("missing-key")}>
                <MapCanvas className="h-full w-full overflow-hidden rounded-xl" gestureHandling="cooperative">
                    {/* The pins frame themselves once, so every movement is
                        already in view: opening one needs no camera move */}
                    <OverviewPins
                        entities={entities}
                        matches={NO_MATCHES}
                        query=""
                        selected={selected}
                        onSelect={onSelect}
                    />
                </MapCanvas>
            </GoogleMapsProvider>

            {/* A strip along the bottom rather than a corner card: this canvas
                is a fraction of the map page's height, and a floating card
                would sit over the pins around the truck just opened. */}
            {selectedEntity && (
                <MapSelectedCard
                    key={selectedEntity.id}
                    entity={selectedEntity}
                    onClose={onClose}
                    className="absolute inset-x-2 bottom-2 z-20"
                />
            )}
        </div>
    )
}
