"use client"

import { useQuery } from "@tanstack/react-query"

import { TRAIL_POLL_MS } from "@workspace/maps/types"

import { useTRPC } from "@/backend/api/client"
import { RouteMap } from "@/frontend/pages/map/components/route-map"
import { movementTone, type MovementStatus } from "@/frontend/pages/movements/types"

/**
 * The map on a load's page. The route is geometry the server already paid
 * Google for, so it is cached hard and never retried; the trail polls,
 * because the point is watching a truck move. A linked order's trail is the
 * one from the row with the truck — the server resolves that.
 *
 * The map kit paints its truck pin from the order status vocabulary, which
 * owns the colour tokens; the pin takes the load's tone, the same one its
 * status chip wears.
 */
export function MovementRouteMap({
    loadId,
    status,
    className,
}: {
    loadId: string
    status: MovementStatus
    className?: string
}) {
    const trpc = useTRPC()

    const route = useQuery(trpc.movements.route.queryOptions({ id: loadId }, { staleTime: 5 * 60_000, retry: false }))
    const trail = useQuery(trpc.movements.trail.queryOptions({ id: loadId }, { refetchInterval: TRAIL_POLL_MS }))

    return (
        <RouteMap
            route={route.data}
            trail={trail.data ?? []}
            routeFailed={route.isError}
            status={movementTone(status)}
            className={className}
        />
    )
}
