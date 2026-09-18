"use client"

import { useEffect, useMemo, useRef } from "react"
import { useMap } from "@vis.gl/react-google-maps"

import { useTranslations } from "@workspace/i18n"

import { MapCanvas } from "@workspace/maps/components/map-canvas"
import { GoogleMapsProvider } from "@workspace/maps/components/maps-provider"

import { MapSelectedCard } from "@/frontend/pages/map/sections/map-selected-card"
import { OverviewPins } from "@/frontend/pages/map/sections/overview-pins"
import type { MapOrder } from "@/frontend/pages/map/types"

/**
 * The fleet as a block on the dashboard: the same pins and the same open-load
 * card as `/map`, minus everything that needs the whole viewport — no search,
 * no trail, no route layer. Gestures stay "cooperative" (the canvas default)
 * because the page scrolls behind this card and a wheel over the map must
 * scroll it, not zoom.
 *
 * This is the only file on the dashboard allowed to import the Maps
 * components; everything else reaches it through `fleet-map.lazy.tsx`, so the
 * Maps bundle never lands in the page's first paint.
 */

/** No search box here, so no pin is ever a "match" — one frozen set, stable across renders. */
const NO_MATCHES: Set<string> = new Set()

/** Close enough to place a truck on its road without losing the province around it. */
const SELECTED_ZOOM = 10

/**
 * Brings the open truck into view. Lives inside the canvas so `useMap()`
 * resolves this card's map instance rather than a neighbouring one, and
 * renders nothing of its own.
 */
function PanToSelected({ order }: { order: MapOrder | null }) {
    const map = useMap()

    // Which load the camera was last moved for. The overview polls every
    // minute, so panning whenever the coordinates change would drag the camera
    // off whatever the operator just looked at, once a minute; panning only on
    // a new selection keeps the map theirs between picks.
    const panned = useRef<string | null>(null)

    useEffect(() => {
        if (!order) {
            // Re-picking the same truck after closing it should move again
            panned.current = null
            return
        }

        if (!map || !order.lastLocation || panned.current === order.orderId) return

        panned.current = order.orderId
        map.panTo({ lat: order.lastLocation.lat, lng: order.lastLocation.lng })
        map.setZoom(SELECTED_ZOOM)
    }, [map, order])

    return null
}

export function FleetMap({
    orders,
    selected,
    onSelect,
    onClose,
}: {
    orders: MapOrder[]
    selected: string | null
    onSelect: (orderId: string) => void
    onClose: () => void
}) {
    const t = useTranslations("Admin.map.detail")

    const selectedOrder = useMemo(
        () => orders.find((order) => order.orderId === selected) ?? null,
        [orders, selected],
    )

    return (
        <div className="relative h-full">
            <GoogleMapsProvider missingKeyMessage={t("missing-key")}>
                <MapCanvas className="h-full w-full overflow-hidden rounded-xl" gestureHandling="cooperative">
                    <OverviewPins
                        orders={orders}
                        matches={NO_MATCHES}
                        query=""
                        selected={selected}
                        hasTrail={false}
                        onSelect={onSelect}
                    />

                    <PanToSelected order={selectedOrder} />
                </MapCanvas>
            </GoogleMapsProvider>

            {/* A strip along the bottom rather than a corner card: this canvas
                is a fifth of the map page's height, and a floating card would
                sit over the pins around the truck just opened. */}
            {selectedOrder && (
                <MapSelectedCard
                    key={selectedOrder.orderId}
                    order={selectedOrder}
                    onClose={onClose}
                    className="absolute inset-x-2 bottom-2 z-20"
                />
            )}
        </div>
    )
}
