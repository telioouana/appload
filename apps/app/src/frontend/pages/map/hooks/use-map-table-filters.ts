"use client"

import { useCallback } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

import type { MapEntityKind } from "@/frontend/pages/map/types"

export type MapTableFilterKey = "stale" | "status" | "kind"

/**
 * The table view's filters, in the URL so a filtered table can be pasted
 * into a message: `?stale=1` keeps only the trucks silent for over twelve
 * hours, `?status=` one status, `?kind=` orders or trips. All of it is cut
 * in the browser from the overview the page already holds, so every write
 * is shallow — the server never reads these.
 */
export function useMapTableFilters() {
    const { get, shallow } = useListParams()

    const stale = get("stale") === "1"
    const status = get("status")
    const rawKind = get("kind")
    const kind: MapEntityKind | null = rawKind === "order" || rawKind === "load" ? rawKind : null

    const setFilter = useCallback(
        (key: MapTableFilterKey, value: string | null) => shallow({ key, value }),
        [shallow],
    )

    return { stale, status, kind, setFilter }
}
