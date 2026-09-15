"use client"

import { useMemo } from "react"

import type { OrderStatus } from "@workspace/db/types"
import { useFormatter } from "@workspace/i18n"

import { useRouteColors } from "@workspace/maps/lib/colors"
import { decodePolyline } from "@workspace/maps/lib/geometry"
import { buildTrail } from "@workspace/maps/lib/trail"
import type { LatLng, OrderRouteDto, TrailPoint } from "@workspace/maps/types"
import { PingDot, StatusPin, StopMarker } from "@workspace/maps/components/markers"
import { Polyline } from "@workspace/maps/components/polyline"
import { useFitBounds } from "@workspace/maps/lib/use-fit-bounds"

type Props = {
    route: OrderRouteDto | null | undefined
    trail: TrailPoint[]
    status: OrderStatus
    /** Frame the route and its pings once they change. Off for maps the parent frames itself. */
    fit?: boolean
    onPinClick?: () => void
    selected?: boolean
    /** Search treatment for the truck pin, so a selected load still stands out or dims like the overview pins */
    emphasis?: "normal" | "match" | "dim"
}

/**
 * One order on a map: the road it should take, how much of it has been
 * covered, every location update behind the truck, and the truck.
 *
 * Draw order is fixed by zIndex, not by JSX order — the covered line has to
 * sit on the route, the spur on both, and the markers above all three:
 *
 *   1 route (grey)   2 covered (orange)   3 spur (dashed)   4-6 markers
 *
 * Renders nothing at all when there is neither a route nor a ping.
 */
export function RouteLayer({ route, trail, status, fit = false, onPinClick, selected = false, emphasis = "normal" }: Props) {
    const colors = useRouteColors()
    const f = useFormatter()

    // The encoded polyline is the expensive part; decode it once per route.
    const routePath = useMemo<LatLng[]>(() => {
        if (!route) {
            return []
        }

        if (route.encodedPolyline) {
            const decoded = decodePolyline(route.encodedPolyline)

            if (decoded.length >= 2) {
                return decoded
            }
        }

        // No road geometry (source "geocode", or an unusable polyline): the
        // straight chord between the two ends is still worth drawing.
        return [route.origin, route.destination]
    }, [route])

    const pings = useMemo<LatLng[]>(() => trail.map((point) => ({ lat: point.lat, lng: point.lng })), [trail])

    const { covered, spur } = useMemo(() => buildTrail(routePath, pings), [routePath, pings])

    const framed = useMemo<LatLng[]>(() => {
        const points: LatLng[] = []

        if (route) {
            points.push(route.origin, route.destination)
        }

        return points.concat(pings)
    }, [route, pings])

    useFitBounds(framed, { enabled: fit })

    const last = trail.at(-1)

    return (
        <>
            {routePath.length >= 2 ? (
                <Polyline path={routePath} strokeColor={colors.route} strokeWeight={4} strokeOpacity={0.9} zIndex={1} />
            ) : null}

            {covered.length >= 2 ? (
                <Polyline path={covered} strokeColor={colors.covered} strokeWeight={5} zIndex={2} />
            ) : null}

            {spur ? (
                <Polyline path={spur} strokeColor={colors.covered} strokeWeight={3} zIndex={3} dashed />
            ) : null}

            {route ? (
                <>
                    <StopMarker position={route.origin} kind="loading" />
                    <StopMarker position={route.destination} kind="offloading" />
                </>
            ) : null}

            {trail.slice(0, -1).map((point) => (
                <PingDot
                    key={point.id}
                    position={{ lat: point.lat, lng: point.lng }}
                    title={pingTitle(point, f.dateTime(point.recordedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}
                />
            ))}

            {last ? (
                <StatusPin
                    position={{ lat: last.lat, lng: last.lng }}
                    status={status}
                    label={pingTitle(last, f.dateTime(last.recordedAt, { hour: "2-digit", minute: "2-digit" }))}
                    emphasis={emphasis}
                    selected={selected}
                    onClick={onPinClick}
                />
            ) : null}
        </>
    )
}

/** "Chimoio · 14:20" when we know where the ping came from, just the time otherwise. */
function pingTitle(point: TrailPoint, formatted: string) {
    return point.placeName ? `${point.placeName} · ${formatted}` : formatted
}
