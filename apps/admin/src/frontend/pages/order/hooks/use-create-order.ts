import { create } from "zustand"

import type { Order, OrderOffer } from "@workspace/db/orders"

interface Props {
    isOpen: boolean
    // When set, the sheet edits this prospect through the create-shaped
    // form (same schema and booking rules as creation) instead of creating
    // a new order
    order: Order | undefined
    // The prospect's pending offers travel with it: the same form writes
    // them, and marking one accepted is what books the order
    offers: OrderOffer[]
    onOpenChange: () => void
    onEdit: (order: Order, offers: OrderOffer[]) => void
    onClose: () => void
}

export const useCreateOrder = create<Props>((set) => ({
    isOpen: false,
    order: undefined,
    offers: [],
    onOpenChange: () => set({ isOpen: true, order: undefined, offers: [] }),
    onEdit: (order, offers) => set({ isOpen: true, order, offers }),
    onClose: () => set({ isOpen: false, order: undefined, offers: [] }),
}))
