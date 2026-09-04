import { OFF_ROUTE_METERS, type LatLng } from "../types"
import { cumulativeDistances, projectOntoPath } from "./geometry"

/**
 * Turns "the planned road route" plus "the location pings we got from the
 * driver" into the three things the map draws:
 *
 * - `covered` — the orange line from the origin to where the truck is,
 * - `spur`    — a dashed hop from the route to a ping that is nowhere near it,
 * - `front`   — the head of the covered line (the truck, snapped to the road).
 *
 * Pure: no React, no `google.maps`.
 */

export type TrailMode = "snap" | "straight"

export type Trail = {
    /** Origin → current position, following the road when we can. */
    covered: LatLng[]
    /** Two points, road → ping, when the last ping is off-route. Otherwise null. */
    spur: LatLng[] | null
    /** Head of `covered`, i.e. where the truck is drawn on the route. */
    front: LatLng | null
}

const EMPTY: Trail = { covered: [], spur: null, front: null }

/**
 * `mode: "snap"` (the default) projects the MOST RECENT ping onto the route
 * and keeps everything before it: the covered line is the real road up to the
 * projection, which is what you want whenever a route exists. A ping further
 * than `OFF_ROUTE_METERS` from the road does not drag the line off the road —
 * it gets a dashed spur instead, so a bad GPS fix or a detour reads as one.
 *
 * `mode: "straight"` ignores the route shape and just connects the pings; it
 * is also the automatic fallback when there is no usable route (fewer than
 * two vertices) or when the projection fails.
 */
export function buildTrail(routePath: LatLng[], pings: LatLng[], mode: TrailMode = "snap"): Trail {
    const last = pings.at(-1)

    if (!last) {
        return EMPTY
    }

    if (mode === "straight" || routePath.length < 2) {
        return straightTrail(routePath, pings, last)
    }

    const projection = projectOntoPath(routePath, cumulativeDistances(routePath), last)

    if (!projection) {
        return straightTrail(routePath, pings, last)
    }

    return {
        covered: [...routePath.slice(0, projection.segment + 1), projection.snapped],
        spur: projection.distance > OFF_ROUTE_METERS ? [projection.snapped, last] : null,
        front: projection.snapped,
    }
}

/** Origin (when known) followed by every ping, in order. */
function straightTrail(routePath: LatLng[], pings: LatLng[], last: LatLng): Trail {
    const start = routePath[0] ?? pings[0]

    return {
        covered: start ? [start, ...pings] : [...pings],
        spur: null,
        front: last,
    }
}
