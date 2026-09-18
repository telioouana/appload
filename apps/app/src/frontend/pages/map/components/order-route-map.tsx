"use client"

import { useQuery } from "@tanstack/react-query"

import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses"

import { useTRPC } from "@/backend/api/client"

import { RouteMap } from "@/frontend/pages/map/components/route-map"
import { TRAIL_POLL_MS, type OrderStatus } from "@/frontend/pages/map/types"

type Props = {
    /** The human order id, e.g. APPL275.26. */
    orderId: string
    status: OrderStatus
    className?: string
}

/**
 * The map inside an order.
 *
 * The two queries are deliberately different animals. A route is geometry the
 * server has already paid Google for, so it is cached hard and never retried —
 * an order without addresses we can geocode will never have one, and hammering
 * the endpoint would not change that. The trail polls only while a truck is
 * actually on the road; a booked order has nothing to poll for yet.
 */
export function OrderRouteMap({ orderId, status, className }: Props) {
    const trpc = useTRPC()

    const tracked = TRACKED_STATUSES.includes(status)

    const route = useQuery(trpc.map.orderRoute.queryOptions({ orderId }, { staleTime: 5 * 60_000, retry: false }))
    const trail = useQuery(trpc.map.orderTrail.queryOptions({ orderId }, { refetchInterval: tracked ? TRAIL_POLL_MS : false }))

    return (
        <RouteMap
            route={route.data}
            trail={trail.data ?? []}
            routeFailed={route.isError}
            status={status}
            className={className}
        />
    )
}
