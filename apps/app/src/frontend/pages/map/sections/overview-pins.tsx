"use client"

import { useMemo } from "react"

import { StatusPin } from "@workspace/maps/components/markers"
import { spreadOverlapping } from "@workspace/maps/lib/geometry"
import { useFitBounds } from "@workspace/maps/lib/use-fit-bounds"

import type { LatLng, MapEntity } from "@/frontend/pages/map/types"

/**
 * One status pin per movement on the road, at its last known position. Lives
 * inside the map, so it renders nothing of its own — every child is an
 * overlay the Maps API owns.
 */
export function OverviewPins({
    entities,
    matches,
    query,
    selected,
    hasTrail = false,
    onSelect,
}: {
    entities: MapEntity[]
    /** Entity ids matching the search; only meaningful while `query` is set */
    matches: Set<string>
    query: string
    selected: string | null
    /** Whether the selected movement's route layer already has a pin of its own */
    hasTrail?: boolean
    onSelect: (id: string) => void
}) {
    // Trucks parked in the same yard — or pinging from the same cell tower —
    // land on one another; nudge them onto a small ring so each stays clickable
    const placed = useMemo(
        () => spreadOverlapping(
            entities.flatMap((entity) => entity.lastPosition
                ? [{ entity, lat: entity.lastPosition.lat, lng: entity.lastPosition.lng }]
                : []),
        ),
        [entities],
    )

    const points = useMemo<LatLng[]>(() => placed.map(({ lat, lng }) => ({ lat, lng })), [placed])

    // The camera follows the whole fleet only while nothing is open; a
    // selected movement's route owns the viewport instead. Framed once: the
    // overview polls, so refitting on every changed point would drag the
    // camera off whatever the reader just panned to, once a minute. "Show
    // all" is how you get the fleet back.
    useFitBounds(points, { enabled: !selected, once: true })

    return (
        <>
            {placed.map(({ entity, lat, lng }) => {
                // The selected movement's route draws its own pin on this
                // exact point — two pins on one spot would just fight for the
                // click. Only once it actually has one, though: the trail is
                // a round trip away, and until it lands this is the clicked
                // truck's only marker.
                if (entity.id === selected && hasTrail) return null

                return (
                    <StatusPin
                        key={entity.id}
                        position={{ lat, lng }}
                        status={entity.status}
                        label={entity.ref}
                        emphasis={!query ? "normal" : matches.has(entity.id) ? "match" : "dim"}
                        onClick={() => onSelect(entity.id)}
                    />
                )
            })}
        </>
    )
}
