"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order"
import { useUpdateOrder } from "@/frontend/pages/order/hooks/use-update-order"
import type { OrderStatus } from "@/frontend/pages/orders/types"

/**
 * Edit and Confirm from a list row. The forms want the whole order — a
 * prospect edits through the create-shaped form, everything else through
 * the tabbed patch sheet — and the row only carries the columns the table
 * shows, so the full row is fetched first (usually from cache: the sheet
 * reads the same query).
 */
export function useOrderActions() {
    const t = useTranslations("Admin.orders.list.errors")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { onEdit, onConfirm } = useCreateOrder()
    const { onOpen } = useUpdateOrder()

    const load = useCallback(
        (orderId: string) => queryClient.fetchQuery(trpc.order.get.queryOptions({ orderId })).then((data) => data.order),
        [queryClient, trpc],
    )

    const edit = useCallback((orderId: string, status: OrderStatus) =>
        load(orderId)
            .then((order) => (status === "prospect" ? onEdit(order) : onOpen(order)))
            .catch(() => toast.error(t("load"))), [load, onEdit, onOpen, t])

    const confirm = useCallback((orderId: string) =>
        load(orderId)
            .then((order) => onConfirm(order))
            .catch(() => toast.error(t("load"))), [load, onConfirm, t])

    return { edit, confirm }
}
