"use client"

import { useCallback } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

/**
 * Which row's sheet is open, kept in the URL rather than in a store: a sheet
 * can be linked to, a refresh reopens it, and the browser's back button
 * closes it.
 *
 * Every list page in both apps wanted the same three lines, so it is one
 * hook. `param` is there for a page that opens two different sheets and
 * needs to tell them apart; everything else uses the default.
 */
export function useEntitySheet(param = "id") {
    const { get, set } = useListParams()

    const open = useCallback((id: string) => set({ key: param, value: id }), [set, param])
    const close = useCallback(() => set({ key: param, value: null }), [set, param])

    return { id: get(param), open, close }
}
