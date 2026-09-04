"use client"

import { useCallback } from "react"

import { useListParams } from "@/components/list/use-list-params"

/** Which dispute's sheet is open, kept in the URL (`?id=…`) so it can be linked to. */
export function useDisputeSheet() {
    const { get, set } = useListParams()

    const id = get("id")
    const open = useCallback((nextId: string) => set({ key: "id", value: nextId }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id, open, close }
}
