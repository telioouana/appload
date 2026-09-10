"use client"

import { useCallback, useEffect } from "react"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"]

/** An open sheet, dialog or command palette — Radix's own Escape handling owns the key. */
const MODAL_LAYER = "[data-slot=\"sheet-content\"], [role=\"dialog\"]"

/**
 * Which pin is open (`?id=APPL021.26` or `?id=TRP-12`) and what is being
 * searched (`?q=`), kept in the URL so a view of the map can be pasted into
 * a message and reopen on the same truck. The overview query takes no input,
 * so neither param changes what the server returns: every write is shallow
 * and stays on the client instead of re-running the page.
 */
export function useMapSelection() {
    const { get, shallow } = useListParams()

    const selected = get("id")
    const query = get("q") ?? ""

    const select = useCallback(
        (ref: string | null) => shallow({ key: "id", value: ref }),
        [shallow],
    )

    const setQuery = useCallback(
        (text: string) => shallow({ key: "q", value: text.trim() || null }),
        [shallow],
    )

    // Escape closes the selected movement, the way it closes a sheet — but
    // not while the reader is typing, and not while a sheet, dialog or the
    // command palette is open. Radix calls its own `onEscapeKeyDown` without
    // stopping the event, so the key reaches this window listener too and one
    // press would close the dialog *and* silently drop the pin behind it.
    useEffect(() => {
        if (!selected) return

        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return

            const target = event.target as HTMLElement | null

            if (target && (target.isContentEditable || TYPING_TAGS.includes(target.tagName))) return

            if (document.querySelector(MODAL_LAYER)) return

            shallow({ key: "id", value: null })
        }

        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [selected, shallow])

    return { selected, query, select, setQuery }
}
