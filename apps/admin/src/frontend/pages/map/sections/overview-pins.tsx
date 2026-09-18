"use client"

import { useMemo } from "react"

import { StatusPin } from "@workspace/maps/components/markers"
import { spreadOverlapping } from "@workspace/maps/lib/geometry"
import { useFitBounds } from "@workspace/maps/lib/use-fit-bounds"

import type { LatLng, MapOrder } from "@/frontend/pages/map/types"

/**
 * One status pin per on-going load, at its last known position. Lives inside
 * the map, so it renders nothing of its own — every child is an overlay the
 * Maps API owns.
 */
export function OverviewPins({
    orders,
    matches,
    query,
    selected,
    hasTrail = false,
    onSelect,
}: {
    orders: MapOrder[]
    /** Order ids matching the search; only meaningful while `query` is set */
    matches: Set<string>
    query: string
    selected: string | null
    /** Whether the selected load's route layer already has a pin of its own */
    hasTrail?: boolean
    onSelect: (orderId: string) => void
}) {
    // Trucks parked in the same yard — or pinging from the same cell tower —
    // land on one another; nudge them onto a small ring so each stays clickable
    const placed = useMemo(
        () => spreadOverlapping(
            orders.flatMap((order) => order.lastLocation
                ? [{ order, lat: order.lastLocation.lat, lng: order.lastLocation.lng }]
                : []),
        ),
        [orders],
    )

    const points = useMemo<LatLng[]>(() => placed.map(({ lat, lng }) => ({ lat, lng })), [placed])

    // The camera follows the whole fleet only while nothing is open; a
    // selected load's route owns the viewport instead. Framed once: the
    // overview polls, so refitting on every changed point would drag the
    // camera off whatever the operator just panned to, once a minute. "Show
    // all" is how you get the fleet back.
    useFitBounds(points, { enabled: !selected, once: true })

    return (
        <>
            {placed.map(({ order, lat, lng }) => {
                // The selected load's route draws its own pin on this exact
                // point — two pins on one spot would just fight for the click.
                // Only once it actually has one, though: the trail is a round
                // trip away, and until it lands this is the clicked truck's
                // only marker.
                if (order.orderId === selected && hasTrail) return null

                return (
                    <StatusPin
                        key={order.orderId}
                        position={{ lat, lng }}
                        status={order.status}
                        label={order.orderId}
                        emphasis={!query ? "normal" : matches.has(order.orderId) ? "match" : "dim"}
                        onClick={() => onSelect(order.orderId)}
                    />
                )
            })}
        </>
    )
}
