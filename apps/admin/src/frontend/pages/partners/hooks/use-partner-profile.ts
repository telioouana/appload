"use client"

import { useCallback } from "react"

import { useListParams } from "@/components/list/use-list-params"

export const PROFILE_TABS = ["overview", "documents", "fleet", "drivers", "orders", "activity"] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

/**
 * Which row's profile is open, kept in the URL (`?id=…&tab=…`) rather than
 * in a store: a profile can be linked to, a refresh reopens it, and the
 * browser's back button closes it.
 */
export function usePartnerProfile() {
    const { get, set } = useListParams()

    const id = get("id")
    const rawTab = get("tab")
    const tab: ProfileTab = (PROFILE_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as ProfileTab) : "overview"

    const open = useCallback((nextId: string, nextTab?: ProfileTab) =>
        set([
            { key: "id", value: nextId },
            { key: "tab", value: nextTab && nextTab !== "overview" ? nextTab : null },
        ]), [set])

    const close = useCallback(() => set([{ key: "id", value: null }, { key: "tab", value: null }]), [set])

    const setTab = useCallback((nextTab: ProfileTab) =>
        set({ key: "tab", value: nextTab === "overview" ? null : nextTab }), [set])

    return { id, tab, open, close, setTab }
}
