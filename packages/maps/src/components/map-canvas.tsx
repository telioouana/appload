"use client"

import { ColorScheme, Map } from "@vis.gl/react-google-maps"
import { useTheme } from "next-themes"

import { cn } from "@workspace/ui/lib/utils"

import type { LatLng } from "@workspace/maps/types"

type Props = {
    className?: string
    children?: React.ReactNode
    defaultCenter?: LatLng
    defaultZoom?: number
    /** "greedy" only for a map that owns the viewport — see below. */
    gestureHandling?: "cooperative" | "greedy" | "none" | "auto"
}

/** Mozambique, roughly centred — the country fits at zoom 5. */
const MOZAMBIQUE: LatLng = { lat: -18.5, lng: 35.5 }
const COUNTRY_ZOOM = 5

/**
 * The map surface. It fills its parent, so the parent must have a height
 * (`h-60`, `h-full`, a grid row…) or nothing shows.
 *
 * `colorScheme` is a construction-time option of the Maps API: changing it on
 * a live map does nothing. Keying the component on the resolved theme throws
 * the old map away and builds a new one, which is the supported way to follow
 * a light/dark toggle.
 *
 * Gestures default to "cooperative" because most of these maps are a block
 * inside something that scrolls (the order sheet, the details page): the
 * wheel scrolls the page and ctrl+wheel zooms, so a 240px map cannot trap the
 * scroll. The full-page map passes "greedy" — there is nothing behind it to
 * scroll.
 */
export function MapCanvas({
    className,
    children,
    defaultCenter = MOZAMBIQUE,
    defaultZoom = COUNTRY_ZOOM,
    gestureHandling = "cooperative",
}: Props) {
    const { resolvedTheme } = useTheme()

    // undefined until next-themes has read the document class — render light
    // rather than flashing a dark basemap into a light page.
    const colorScheme = resolvedTheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT

    return (
        <Map
            key={resolvedTheme ?? "light"}
            className={cn("h-full w-full", className)}
            mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
            colorScheme={colorScheme}
            gestureHandling={gestureHandling}
            disableDefaultUI
            defaultCenter={defaultCenter}
            defaultZoom={defaultZoom}
        >
            {children}
        </Map>
    )
}
