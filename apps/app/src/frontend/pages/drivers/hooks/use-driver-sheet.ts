"use client"

import { useCallback } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

/**
 * Which driver's profile is open, kept in the URL (`?id=…`) so it can be
 * linked to, survives a refresh, and closes with the back button.
 */
export function useDriverSheet() {
    const { get, set } = useListParams()

    const id = get("id")

    const open = useCallback((nextId: string) => set({ key: "id", value: nextId }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id, open, close }
}
