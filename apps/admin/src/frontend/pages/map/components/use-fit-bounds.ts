"use client"

import { useEffect, useMemo, useRef } from "react"
import { useMap } from "@vis.gl/react-google-maps"

import { boundsOf } from "../lib/geometry"
import type { LatLng } from "../types"

/**
 * `google.maps.Map`, named through the library instead of the global
 * namespace — `@types/google.maps` is a transitive dependency of
 * @vis.gl/react-google-maps and is not resolvable from this app, so `google.*`
 * cannot be written here (see notes).
 */
export type MapsMap = NonNullable<ReturnType<typeof useMap>>

const DEFAULT_PADDING = 40
const SINGLE_POINT_ZOOM = 12

/** Five decimals is ~1 m — finer than that is noise, and it keeps the key stable across re-renders. */
const keyOf = (point: LatLng) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`

/**
 * Frames `points` on `map`. One point cannot make a bounding box, so it gets a
 * centre and a fixed zoom instead. Safe to call from a click handler — this is
 * the imperative half of `useFitBounds`, used by "Show all" buttons.
 */
export function fitMapTo(map: MapsMap, points: LatLng[], padding = DEFAULT_PADDING, singleZoom = SINGLE_POINT_ZOOM) {
    const first = points[0]

    if (!first) {
        return
    }

    if (points.length === 1) {
        map.setCenter(first)
        map.setZoom(singleZoom)

        return
    }

    const bounds = boundsOf(points)

    if (!bounds) {
        return
    }

    // A bounds literal, so no `new google.maps.LatLngBounds()` is needed.
    map.fitBounds(bounds, padding)
}

type Options = {
    padding?: number
    singleZoom?: number
    enabled?: boolean
    /** Frame once and then leave the camera alone — for a view that polls. */
    once?: boolean
}

/** Identical coordinates make a zero-sized box, which slams the map to its
 *  maximum zoom — collapse them to the single-point case instead. */
function distinct(points: LatLng[]): LatLng[] {
    const seen = new Set<string>()
    const unique: LatLng[] = []

    for (const point of points) {
        const id = keyOf(point)

        if (seen.has(id)) {
            continue
        }

        seen.add(id)
        unique.push(point)
    }

    return unique
}

/**
 * Keeps the camera on `points`, and only when they actually change.
 *
 * Two rules make this behave:
 * - the map has to have finished a render before it can be framed. Fitting one
 *   that has not silently does nothing, so a map without bounds yet waits for
 *   its first `idle`. Waiting for `idle` unconditionally would be a bug: a map
 *   that settled long ago (the overview, when a truck is selected) fires no
 *   further idle on its own and would never frame the route.
 * - the fit is keyed on the rounded coordinates, so a poll that returns the
 *   same positions (or a parent that re-renders) never yanks a map the user
 *   has just panned.
 *
 * That second rule only covers positions that did not change. A view whose
 * points move on a timer — the fleet overview — passes `once`, or every
 * truck that moved a metre would drag the camera back off whatever the
 * operator was looking at. Re-framing then belongs to "Show all".
 */
export function useFitBounds(points: LatLng[] | null | undefined, options?: Options) {
    const map = useMap()
    const padding = options?.padding ?? DEFAULT_PADDING
    const singleZoom = options?.singleZoom ?? SINGLE_POINT_ZOOM
    const enabled = options?.enabled ?? true
    const once = options?.once ?? false

    const lastKey = useRef<string | null>(null)
    const hasFitted = useRef(false)

    // The points themselves are not a dependency of the fit — the key is. This
    // ref hands the effect the current values without re-running it whenever
    // the caller passes a new array with the same coordinates. It is filled in
    // an effect declared *before* the fit, so the fit always reads fresh values.
    const latest = useRef<LatLng[]>([])

    const key = useMemo(() => (points ?? []).map(keyOf).join("|"), [points])

    useEffect(() => {
        latest.current = points ?? []
    }, [points])

    useEffect(() => {
        if (!map || !enabled || !key || lastKey.current === key || (once && hasFitted.current)) {
            return
        }

        const fit = () => {
            lastKey.current = key
            hasFitted.current = true

            fitMapTo(map, distinct(latest.current), padding, singleZoom)
        }

        // `getBounds()` is undefined until the map has drawn once; that is the
        // only state in which fitBounds is ignored.
        if (map.getBounds()) {
            fit()

            return
        }

        const listener = map.addListener("idle", () => {
            listener.remove()
            fit()
        })

        return () => listener.remove()
    }, [map, enabled, key, once, padding, singleZoom])
}
