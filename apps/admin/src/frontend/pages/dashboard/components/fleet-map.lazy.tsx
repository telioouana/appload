"use client"

import dynamic from "next/dynamic"

import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * The fleet map, kept out of the dashboard's first paint.
 *
 * `ssr: false` is the point: the Maps JavaScript API has no server render, and
 * the dashboard is the landing page — nothing there may wait on a map. Import
 * this instead of `./fleet-map`; the props are the same.
 */
export const FleetMapLazy = dynamic(() => import("./fleet-map").then((m) => m.FleetMap), {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-xl" />,
})
