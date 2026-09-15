"use client"

import { useMemo } from "react"
import { useTheme } from "next-themes"

/**
 * Line colours for the map.
 *
 * `google.maps.Polyline` only understands CSS colour strings it can parse
 * itself — it never sees our stylesheet — so these are hex literals, not
 * `var(--…)` tokens. They are picked to sit next to zinc-400/zinc-500 and the
 * Appload orange used everywhere else in the admin.
 */

/** Planned route, light theme (zinc-400). */
export const ROUTE_GREY_LIGHT = "#A1A1AA"
/** Planned route, dark theme (zinc-500) — a step deeper, so the line recedes into the dark basemap and the orange covered path stays the thing you look at. */
export const ROUTE_GREY_DARK = "#71717A"
/** Distance already covered, and every location ping. Same in both themes. */
export const COVERED_ORANGE = "#E67623"

export function useRouteColors(): { route: string; covered: string } {
    const { resolvedTheme } = useTheme()

    // undefined on the first paint (next-themes has not read the class yet) —
    // treat that as light, same as MapCanvas does for the basemap.
    return useMemo(
        () => ({
            route: resolvedTheme === "dark" ? ROUTE_GREY_DARK : ROUTE_GREY_LIGHT,
            covered: COVERED_ORANGE,
        }),
        [resolvedTheme],
    )
}
