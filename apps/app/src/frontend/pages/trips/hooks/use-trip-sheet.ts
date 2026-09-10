"use client"

import { useCallback } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

/**
 * Which trip's panel is open, kept in the URL (`?id=…`) rather than in a
 * store: a trip can be linked to, a refresh reopens the panel and the back
 * button closes it.
 */
export function useTripSheet() {
    const { get, set } = useListParams()

    const open = useCallback((id: string) => set({ key: "id", value: id }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id: get("id"), open, close }
}
