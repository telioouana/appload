"use client"

import { create } from "zustand"

type NewOrderState = {
    isOpen: boolean
    open: () => void
    close: () => void
}

/**
 * Whether the new-order sheet is open. A store rather than the URL: unlike a
 * profile panel there is nothing to link to — a half-typed order is not a
 * page — and the header button and the empty state's call to action both
 * open the same one sheet.
 */
export const useNewOrder = create<NewOrderState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}))
