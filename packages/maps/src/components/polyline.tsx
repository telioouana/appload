"use client"

import { useEffect, useRef } from "react"
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps"

import type { LatLng } from "@workspace/maps/types"

type Props = {
    path: LatLng[]
    /** Hex string — the Maps API parses this itself, so `var(--…)` will not work. */
    strokeColor: string
    strokeWeight?: number
    strokeOpacity?: number
    zIndex?: number
    /** Draws the line as dots instead of a solid stroke (used for the off-route spur). */
    dashed?: boolean
}

/**
 * A `google.maps.Polyline` with a React lifetime. There is no vis.gl overlay
 * involved: the object is created once per map, updated in place when the path
 * or the styling changes, and removed with `setMap(null)` on unmount.
 *
 * The constructor comes from `useMapsLibrary("maps")` rather than the `google`
 * global — same object, but it also tells us the library has finished loading,
 * and it types the instance without naming the global namespace (see notes on
 * `@types/google.maps` not being resolvable from this app).
 *
 * Split across three effects on purpose: a new path must not rebuild the line
 * (it would flicker), and neither must a colour change.
 */
export function Polyline({ path, strokeColor, strokeWeight = 4, strokeOpacity = 1, zIndex = 1, dashed = false }: Props) {
    const map = useMap()
    const maps = useMapsLibrary("maps")
    const line = useRef<InstanceType<NonNullable<typeof maps>["Polyline"]> | null>(null)

    useEffect(() => {
        if (!map || !maps) {
            return
        }

        const polyline = new maps.Polyline({ map })
        line.current = polyline

        return () => {
            polyline.setMap(null)
            line.current = null
        }
    }, [map, maps])

    useEffect(() => {
        // `map`/`maps` are dependencies so this re-runs after the line is rebuilt.
        if (!line.current) {
            return
        }

        line.current.setPath(path)
    }, [map, maps, path])

    useEffect(() => {
        if (!line.current) {
            return
        }

        line.current.setOptions(
            dashed
                ? {
                    strokeColor,
                    // The stroke itself is invisible; the repeated symbol is the line.
                    strokeOpacity: 0,
                    strokeWeight,
                    zIndex,
                    icons: [
                        {
                            icon: { path: "M 0,-1 0,1", strokeColor, strokeOpacity: 1, scale: 3 },
                            offset: "0",
                            repeat: "12px",
                        },
                    ],
                }
                : { strokeColor, strokeOpacity, strokeWeight, zIndex, icons: [] },
        )
    }, [map, maps, dashed, strokeColor, strokeWeight, strokeOpacity, zIndex])

    return null
}
