"use client"

import { useCallback } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

/**
 * Which vehicle's profile is open, kept in the URL (`?id=…`) rather than in a
 * store: a profile can be linked to, a refresh reopens it, and the browser's
 * back button closes it.
 */
export function useVehicleSheet() {
    const { get, set } = useListParams()

    const id = get("id")

    const open = useCallback((nextId: string) => set({ key: "id", value: nextId }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id, open, close }
}
