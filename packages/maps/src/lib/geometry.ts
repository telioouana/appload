import type { LatLng } from "@workspace/maps/types"

/**
 * Pure geometry helpers for the map. No React, no `google.maps` — everything
 * here runs on the server, in a test, or inside a `useMemo` without waiting
 * for the Maps JavaScript API to load.
 *
 * Distances use two different models on purpose:
 * - haversine for anything reported to a human (route length, "how far off
 *   the road is this ping"),
 * - a flat equirectangular projection for the per-segment maths, where the
 *   segments are a few kilometres long and the error is far below the GPS
 *   noise we are projecting in the first place.
 */

/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_M = 6_371_008.8
/** Metres per degree of latitude (constant enough between the poles). */
const METERS_PER_DEG_LAT = 110_540
/** Metres per degree of longitude at the equator; shrinks with cos(lat). */
const METERS_PER_DEG_LNG = 111_320

const toRad = (deg: number) => (deg * Math.PI) / 180
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Decodes a Google "encoded polyline algorithm" string (5 decimal places).
 *
 * Every coordinate is stored as a delta from the previous one, zig-zag
 * encoded (`v < 0 ? ~(v << 1) : (v << 1)`) then chunked into 5-bit groups,
 * each group ORed with 0x20 while more groups follow, and offset by 63 so the
 * result is printable ASCII. Decoding walks that backwards.
 *
 * Self-check (Google's own sample):
 *   decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") ===
 *   [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]
 */
export function decodePolyline(encoded: string): LatLng[] {
    const points: LatLng[] = []
    let index = 0
    let lat = 0
    let lng = 0

    while (index < encoded.length) {
        let shift = 0
        let result = 0
        let byte = 0

        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20 && index < encoded.length)

        lat += result & 1 ? ~(result >> 1) : result >> 1

        shift = 0
        result = 0

        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20 && index < encoded.length)

        lng += result & 1 ? ~(result >> 1) : result >> 1

        points.push({ lat: lat / 1e5, lng: lng / 1e5 })
    }

    return points
}

/**
 * Great-circle distance in metres.
 *
 *   a = sin²(dPhi / 2) + cos(phi1) · cos(phi2) · sin²(dLambda / 2)
 *   d = 2R · atan2(sqrt(a), sqrt(1 − a))
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)

    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Local flat projection of `p` around `ref`, in metres.
 *
 *   x = dLng · cos(lat_ref) · 111320
 *   y = dLat · 110540
 *
 * Good to a fraction of a percent over the tens of kilometres a route segment
 * spans, and it turns "distance from a point to a segment" into plain 2D
 * vector maths.
 */
export function toMeters(p: LatLng, ref: LatLng): { x: number; y: number } {
    return {
        x: (p.lng - ref.lng) * Math.cos(toRad(ref.lat)) * METERS_PER_DEG_LNG,
        y: (p.lat - ref.lat) * METERS_PER_DEG_LAT,
    }
}

/**
 * Distance from the start of the path to each vertex, metres.
 * `cumulativeDistances(path)[i]` is the length of `path.slice(0, i + 1)`, so
 * the array always starts at 0 and has the same length as `path`.
 */
export function cumulativeDistances(path: LatLng[]): number[] {
    const cum: number[] = []
    let total = 0

    for (let i = 0; i < path.length; i++) {
        const current = path[i]
        const previous = path[i - 1]

        if (i > 0 && current && previous) {
            total += haversineMeters(previous, current)
        }

        cum.push(total)
    }

    return cum
}

export type PathProjection = {
    /** Index of the segment `[path[segment], path[segment + 1]]`. */
    segment: number
    /** Position along that segment, 0 at its start, 1 at its end. */
    t: number
    /** Distance from the start of the whole path to the snapped point, metres. */
    along: number
    /** Distance from `point` to the snapped point, metres. */
    distance: number
    /** The point on the path closest to `point`. */
    snapped: LatLng
}

/**
 * Projects `point` onto the closest segment of `path`.
 *
 * For each segment A→B the metre frame is centred on `point`, so P is the
 * origin and the classic clamp applies:
 *
 *   t = clamp( (AP · AB) / |AB|² , 0, 1 )       with AP = P − A = −A
 *   C = A + t · AB
 *   distance = |C|
 *
 * The segment with the smallest distance wins. `snapped` interpolates the
 * degrees linearly with the same `t` — over one segment that is the same
 * point, to well under a metre.
 *
 * `cum` must come from `cumulativeDistances(path)`; it is passed in so a
 * caller projecting many points pays for it once.
 */
export function projectOntoPath(path: LatLng[], cum: number[], point: LatLng): PathProjection | null {
    if (path.length < 2) {
        return null
    }

    let best: PathProjection | null = null

    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]
        const b = path[i + 1]

        if (!a || !b) {
            continue
        }

        const A = toMeters(a, point)
        const B = toMeters(b, point)
        const abx = B.x - A.x
        const aby = B.y - A.y
        const len2 = abx * abx + aby * aby
        // AP = P − A, and P is the origin of this frame, hence the minus signs.
        const t = len2 === 0 ? 0 : clamp((-A.x * abx + -A.y * aby) / len2, 0, 1)
        const cx = A.x + t * abx
        const cy = A.y + t * aby
        const distance = Math.hypot(cx, cy)

        if (best && distance >= best.distance) {
            continue
        }

        const from = cum[i] ?? 0
        const to = cum[i + 1] ?? from

        best = {
            segment: i,
            t,
            along: from + t * (to - from),
            distance,
            snapped: {
                lat: a.lat + (b.lat - a.lat) * t,
                lng: a.lng + (b.lng - a.lng) * t,
            },
        }
    }

    return best
}

/**
 * Fans out markers that would otherwise stack on the exact same pixel.
 *
 * Points are bucketed into ~55 m cells (`round(deg * 2000)`); any cell with
 * more than one point gets its members placed on a ring of `radiusMeters`
 * around their own position, item `i` of `n` at angle `2π·i/n`:
 *
 *   dLat = r · sin(theta) / 111320
 *   dLng = r · cos(theta) / (111320 · cos(lat))
 *
 * Returns shallow copies (the originals are never mutated) in the input
 * order, so the caller can keep indexing by the same array positions.
 */
export function spreadOverlapping<T extends LatLng>(items: T[], radiusMeters = 40): T[] {
    const buckets = new Map<string, number[]>()

    items.forEach((item, index) => {
        const key = `${Math.round(item.lat * 2000)}:${Math.round(item.lng * 2000)}`
        const bucket = buckets.get(key)

        if (bucket) {
            bucket.push(index)
        } else {
            buckets.set(key, [index])
        }
    })

    const out = items.slice()

    for (const indexes of buckets.values()) {
        if (indexes.length < 2) {
            continue
        }

        indexes.forEach((index, i) => {
            const item = items[index]

            if (!item) {
                return
            }

            const angle = (2 * Math.PI * i) / indexes.length
            // cos(lat) collapses at the poles; nothing we map is anywhere near
            // one, but the guard keeps the maths finite regardless.
            const cosLat = Math.max(Math.cos(toRad(item.lat)), 1e-6)

            out[index] = {
                ...item,
                lat: item.lat + (radiusMeters * Math.sin(angle)) / METERS_PER_DEG_LAT,
                lng: item.lng + (radiusMeters * Math.cos(angle)) / (METERS_PER_DEG_LNG * cosLat),
            }
        })
    }

    return out
}

/** Axis-aligned bounding box, or null for an empty set. The antimeridian is not a concern here. */
export function boundsOf(points: LatLng[]): { north: number; south: number; east: number; west: number } | null {
    const first = points[0]

    if (!first) {
        return null
    }

    let north = first.lat
    let south = first.lat
    let east = first.lng
    let west = first.lng

    for (const point of points) {
        if (point.lat > north) north = point.lat
        if (point.lat < south) south = point.lat
        if (point.lng > east) east = point.lng
        if (point.lng < west) west = point.lng
    }

    return { north, south, east, west }
}
