"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { planRefusal } from "@/components/plan-dialog"
import { movementErrorKey } from "@/frontend/pages/movements/lib/errors"

/**
 * The load mutations the lists, the detail page and the dialogs share.
 *
 * Every success refreshes the whole movements tree — a move changes a row's
 * section, two tiles and the page it is shown on — and the rail's counts,
 * which read the same rows.
 *
 * Moves that start tracking are what a plan pays for: when the server
 * answers with one of the two plan codes the caller opens the plan dialog
 * instead, and a toast saying the same thing would only land on top of it.
 * Dialogs that show their own error inline pass `onError` and get no toast.
 */
export function useMovementMutations() {
    const t = useTranslations("App.loads")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.movements.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.me.railCounts.queryKey() }),
    ])

    const fail = (error: unknown) => toast.error(t(`errors.${movementErrorKey(error)}`))

    const planAware = (error: unknown) => { if (planRefusal(error) === null) fail(error) }

    const create = useMutation(trpc.movements.create.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t("toasts.created", { ref: data.ref })) },
    }))

    const update = useMutation(trpc.movements.update.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.updated")) },
    }))

    const transition = useMutation(trpc.movements.transition.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t(`toasts.status.${data.status}`)) },
    }))

    const offer = useMutation(trpc.movements.offer.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.offered")) },
        onError: planAware,
    }))

    const withdraw = useMutation(trpc.movements.withdraw.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.withdrawn")) },
        onError: fail,
    }))

    const respond = useMutation(trpc.movements.respond.mutationOptions({
        onSuccess: (_data, input) => {
            void refresh()
            toast.success(t(input.decision === "accept" ? "toasts.accepted" : "toasts.declined"))
        },
    }))

    const convert = useMutation(trpc.movements.convert.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t("toasts.converted", { ref: data.ref })) },
    }))

    const recordPayment = useMutation(trpc.movements.recordPayment.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.payment")) },
    }))

    const addCost = useMutation(trpc.movements.costs.add.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.cost-added")) },
    }))

    const removeCost = useMutation(trpc.movements.costs.remove.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.cost-removed")) },
        onError: fail,
    }))

    const addDocument = useMutation(trpc.movements.documents.add.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.document-added")) },
    }))

    const removeDocument = useMutation(trpc.movements.documents.remove.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.document-removed")) },
        onError: fail,
    }))

    const requestLocation = useMutation(trpc.movements.requestLocation.mutationOptions({
        onSuccess: (data) => {
            void refresh()

            // The message is stored either way, so a failed send is reported
            // as what it is rather than as a success nobody received
            if (data.sent) {
                toast.success(t("toasts.requested"))
            } else {
                toast.error(t("errors.sendFailed"))
            }
        },
        onError: fail,
    }))

    return {
        create,
        update,
        transition,
        offer,
        withdraw,
        respond,
        convert,
        recordPayment,
        addCost,
        removeCost,
        addDocument,
        removeDocument,
        requestLocation,
        refresh,
        fail,
        planAware,
    }
}
