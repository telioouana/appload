"use client"

import { useCallback } from "react"

import { useListParams } from "@/components/list/use-list-params"

/**
 * Which quote's panel is open, kept in the URL (`?id=…`) rather than in a
 * store: a quote can be linked to, a refresh reopens the panel and the back
 * button closes it.
 */
export function useQuoteSheet() {
    const { get, set } = useListParams()

    const open = useCallback((id: string) => set({ key: "id", value: id }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id: get("id"), open, close }
}
