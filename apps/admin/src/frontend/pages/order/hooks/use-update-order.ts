import { create } from "zustand"

import type { Order } from "@workspace/db/orders"

interface Props {
    isOpen: boolean
    order: Order | undefined
    onOpen: (order: Order) => void
    // Refreshes the sheet with the post-derivation row a save returns, so
    // continued editing starts from fresh data instead of the stale list row
    setOrder: (order: Order) => void
    onClose: () => void
}

export const useUpdateOrder = create<Props>((set) => ({
    isOpen: false,
    order: undefined,
    onOpen: (order) => set({ isOpen: true, order }),
    setOrder: (order) => set({ order }),
    onClose: () => set({ isOpen: false, order: undefined }),
}))
