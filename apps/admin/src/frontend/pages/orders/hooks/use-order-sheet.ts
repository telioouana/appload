"use client"

import { useCallback } from "react"

import { useListParams } from "@/components/list/use-list-params"

export const ORDER_TABS = ["overview", "offers", "payments", "documents", "history"] as const
export type OrderTab = (typeof ORDER_TABS)[number]

/**
 * Which order's sheet is open, kept in the URL (`?id=APPL021.26&tab=…`)
 * rather than in a store: a sheet can be linked to, a refresh reopens it,
 * and the browser's back button closes it. The id is the human one, so the
 * sheet reads the same `order.get` the full page does.
 */
export function useOrderSheet() {
    const { get, set } = useListParams()

    const id = get("id")
    const rawTab = get("tab")
    const tab: OrderTab = (ORDER_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as OrderTab) : "overview"

    const open = useCallback((nextId: string, nextTab?: OrderTab) =>
        set([
            { key: "id", value: nextId },
            { key: "tab", value: nextTab && nextTab !== "overview" ? nextTab : null },
        ]), [set])

    const close = useCallback(() => set([{ key: "id", value: null }, { key: "tab", value: null }]), [set])

    const setTab = useCallback((nextTab: OrderTab) =>
        set({ key: "tab", value: nextTab === "overview" ? null : nextTab }), [set])

    return { id, tab, open, close, setTab }
}
