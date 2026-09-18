"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { orderErrorKey } from "@/frontend/pages/orders/lib/errors"

/**
 * Every order mutation the pages share, each refreshing the whole `orders`
 * key on success: a status change moves a row between sections, changes two
 * tiles and rewrites the timeline, so the lists and the counts have to
 * refetch together.
 *
 * These calls are taken from the load page too, where the order is worked
 * from the row that follows it: booking one, moving it on, dispatching it or
 * calling it off all rewrite that row and the rail's counts, so both refetch
 * with the order.
 *
 * Errors are deliberately NOT toasted here. The dialogs that own these
 * calls show the reason in place, next to the control that failed; the two
 * fire-and-forget actions (withdrawing a request, declining an offer) are
 * the exception and ask for `fail` themselves.
 */
export function useOrderMutations() {
    const t = useTranslations("App.orders")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.orders.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.movements.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.me.railCounts.queryKey() }),
    ])

    /** The domain reason a call failed, as a toast — for actions with no dialog of their own. */
    const fail = (error: unknown) => toast.error(t(`errors.${orderErrorKey(error)}`))

    const create = useMutation(trpc.orders.create.mutationOptions({
        onSuccess: () => { void refresh() },
    }))

    const sendRequests = useMutation(trpc.orders.sendRequests.mutationOptions({
        onSuccess: (result) => {
            void refresh()
            toast.success(t("requests.toasts.sent", { count: result.sent }))
        },
    }))

    const withdrawRequest = useMutation(trpc.orders.withdrawRequest.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("requests.toasts.withdrawn")) },
        onError: fail,
    }))

    const cancel = useMutation(trpc.orders.cancel.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("cancel.toasts.cancelled")) },
    }))

    const transition = useMutation(trpc.orders.transition.mutationOptions({
        onSuccess: () => { void refresh() },
    }))

    const addDocument = useMutation(trpc.orders.documents.add.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("documents.toasts.added")) },
    }))

    const createOffer = useMutation(trpc.orders.offers.create.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("offers.toasts.sent")) },
    }))

    const updateOffer = useMutation(trpc.orders.offers.update.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("offers.toasts.updated")) },
    }))

    const withdrawOffer = useMutation(trpc.orders.offers.withdraw.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("offers.toasts.withdrawn")) },
        onError: fail,
    }))

    const acceptOffer = useMutation(trpc.orders.offers.accept.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("offers.toasts.accepted")) },
    }))

    const declineOffer = useMutation(trpc.orders.offers.decline.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("offers.toasts.declined")) },
        onError: fail,
    }))

    return {
        refresh,
        fail,
        create,
        sendRequests,
        withdrawRequest,
        cancel,
        transition,
        addDocument,
        createOffer,
        updateOffer,
        withdrawOffer,
        acceptOffer,
        declineOffer,
    }
}
