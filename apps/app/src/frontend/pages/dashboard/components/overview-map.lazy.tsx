"use client"

import dynamic from "next/dynamic"

import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * The board's map, kept out of its first paint.
 *
 * `ssr: false` is the point: the Maps JavaScript API has no server render, and
 * this is the page signing in lands on — nothing there may wait on a map.
 * Import this instead of `./overview-map`; the props are the same.
 */
export const OverviewMapLazy = dynamic(() => import("./overview-map").then((m) => m.OverviewMap), {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-xl" />,
})
