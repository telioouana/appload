"use client"

import { useCallback } from "react"

import { useListParams } from "@/components/list/use-list-params"

/**
 * Which connection's profile is open, kept in the URL (`?id=…`) rather than
 * in a store: a partner can be linked to, a refresh reopens the panel and
 * the back button closes it.
 */
export function usePartnerSheet() {
    const { get, set } = useListParams()

    const open = useCallback((id: string) => set({ key: "id", value: id }), [set])
    const close = useCallback(() => set({ key: "id", value: null }), [set])

    return { id: get("id"), open, close }
}
