import { create } from "zustand"

import type { Order } from "@workspace/db/orders"

// How the sheet was entered. "confirm" aims the form at booking: the status
// starts on "booked" so Save books the order and validation names every
// field still missing. "edit" opens the row on its stored status.
type Intent = "edit" | "confirm"

interface Props {
    isOpen: boolean
    // When set, the sheet edits this prospect through the create-shaped
    // form (same schema and booked-completeness rules as creation) instead
    // of creating a new order
    order: Order | undefined
    intent: Intent
    onOpenChange: () => void
    onEdit: (order: Order) => void
    onConfirm: (order: Order) => void
    onClose: () => void
}

// Every state-setting action resets `intent`, so it can never leak from a
// Confirm session into a later plain Edit
export const useCreateOrder = create<Props>((set) => ({
    isOpen: false,
    order: undefined,
    intent: "edit",
    onOpenChange: () => set({ isOpen: true, order: undefined, intent: "edit" }),
    onEdit: (order) => set({ isOpen: true, order, intent: "edit" }),
    onConfirm: (order) => set({ isOpen: true, order, intent: "confirm" }),
    onClose: () => set({ isOpen: false, order: undefined, intent: "edit" }),
}))
