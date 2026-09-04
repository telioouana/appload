"use client"

import { APIProvider } from "@vis.gl/react-google-maps"

import { MapPlaceholder } from "./map-placeholder"

/**
 * Loads the Maps JavaScript API once for whatever it wraps. Nesting two of
 * these is safe — the library keeps a single script tag per key — so every
 * map on the page can bring its own provider and stay self-contained.
 *
 * The key is a build-time inline: `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
 * has to appear literally, spelled out, or Next has nothing to substitute.
 */

/** Advanced markers (our status pins) need the "marker" library. */
const LIBRARIES = ["marker"]

/** False when the browser key is missing, i.e. every map renders a placeholder. */
export function mapsConfigured(): boolean {
    return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
}

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

    if (!apiKey) {
        return <MapPlaceholder />
    }

    return (
        <APIProvider apiKey={apiKey} libraries={LIBRARIES}>
            {children}
        </APIProvider>
    )
}
