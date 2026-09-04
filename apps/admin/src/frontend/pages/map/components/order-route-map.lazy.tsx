"use client"

import dynamic from "next/dynamic"

import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * The map, kept out of every bundle that merely *might* show one.
 *
 * `ssr: false` is the point: the Maps JavaScript API has no server render, and
 * prerendering the canvas only to throw it away costs a flash. Importing this
 * module instead of `./order-route-map` is otherwise a no-op — same props.
 */
export const OrderRouteMapLazy = dynamic(() => import("./order-route-map").then((m) => m.OrderRouteMap), {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-xl" />,
})
