"use client"

import { useQuery } from "@tanstack/react-query"

import type { OrderStatus } from "@workspace/db/types"
import { TRAIL_POLL_MS } from "@workspace/maps/types"

import { useTRPC } from "@/backend/api/client"
import { RouteMap } from "@/frontend/pages/map/components/route-map"
import type { MovementStatus } from "@/frontend/pages/movements/types"

/**
 * The map kit paints its truck pin from the order status vocabulary, which
 * owns the colour tokens; each load status maps onto the order status that
 * means the same thing on a map.
 */
const PIN_STATUS: Record<MovementStatus, OrderStatus> = {
    "procurement": "prospect",
    "offered": "prospect",
    "declined": "prospect",
    "scheduled": "booked",
    "in-transit": "on-route",
    "delivered": "delivered",
    "closed": "completed",
    "cancelled": "cancelled",
}

/**
 * The map on a load's page. The route is geometry the server already paid
 * Google for, so it is cached hard and never retried; the trail polls,
 * because the point is watching a truck move. A linked order's trail is the
 * one from the row with the truck — the server resolves that.
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
            status={PIN_STATUS[status]}
            className={className}
        />
    )
}
