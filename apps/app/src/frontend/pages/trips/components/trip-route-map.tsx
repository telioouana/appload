"use client"

import { useQuery } from "@tanstack/react-query"

import type { OrderStatus } from "@workspace/db/types"
import { TRAIL_POLL_MS } from "@workspace/maps/types"

import { useTRPC } from "@/backend/api/client"
import { RouteMap } from "@/frontend/pages/map/components/route-map"
import type { TripStatus } from "@/frontend/pages/trips/types"

/**
 * The map kit paints its truck pin from the order status vocabulary, which
 * owns the colour tokens. A trip's four states map onto the four order
 * statuses that mean the same thing on a map, so a trip pin and an order pin
 * of the same colour always mean the same thing.
 */
const PIN_STATUS: Record<TripStatus, OrderStatus> = {
    "scheduled": "booked",
    "in-transit": "on-route",
    "delivered": "delivered",
    "cancelled": "cancelled",
}

/**
 * The map inside a trip.
 *
 * The two queries are deliberately different animals. A route is geometry
 * the server has already paid Google for, so it is cached hard and never
 * retried — a trip whose addresses cannot be geocoded will never have one,
 * and hammering the endpoint would not change that. The trail polls, because
 * the whole point is watching a truck move.
 */
export function TripRouteMap({
    tripId,
    status,
    className,
}: {
    tripId: string
    status: TripStatus
    className?: string
}) {
    const trpc = useTRPC()

    const route = useQuery(trpc.trips.route.queryOptions({ id: tripId }, { staleTime: 5 * 60_000, retry: false }))
    const trail = useQuery(trpc.trips.trail.queryOptions({ id: tripId }, { refetchInterval: TRAIL_POLL_MS }))

    return (
        <RouteMap
            route={route.data}
            trail={trail.data ?? []}
            routeFailed={route.isError}
            status={PIN_STATUS[status]}
            className={className}
        />
    )
}
