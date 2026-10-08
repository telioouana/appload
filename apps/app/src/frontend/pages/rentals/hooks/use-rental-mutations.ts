"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { rentalErrorKey } from "@/frontend/pages/rentals/lib/errors"

/**
 * The rental mutations the list, the page and the dialogs share. Every
 * success refreshes the rentals tree and the fleet (a truck on a rental
 * wears a badge there). Dialogs that show their own error inline pass
 * `onError` and get no toast.
 */
export function useRentalMutations() {
    const t = useTranslations("App.rentals")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.rentals.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }),
    ])

    const fail = (error: unknown) => toast.error(t(`errors.${rentalErrorKey(error)}`))
    const ok = { onSuccess: () => { void refresh() } }
    const okOrToast = { onSuccess: () => { void refresh() }, onError: fail }

    return {
        create: useMutation(trpc.rentals.create.mutationOptions(ok)),
        update: useMutation(trpc.rentals.update.mutationOptions(ok)),
        transition: useMutation(trpc.rentals.transition.mutationOptions(okOrToast)),
        addLine: useMutation(trpc.rentals.lines.add.mutationOptions(ok)),
        endLine: useMutation(trpc.rentals.lines.end.mutationOptions(okOrToast)),
        removeLine: useMutation(trpc.rentals.lines.remove.mutationOptions(okOrToast)),
        markDay: useMutation(trpc.rentals.days.mark.mutationOptions(okOrToast)),
        disputeDay: useMutation(trpc.rentals.days.dispute.mutationOptions(okOrToast)),
        settleDispute: useMutation(trpc.rentals.days.settle.mutationOptions(okOrToast)),
        recordPayment: useMutation(trpc.rentals.payments.record.mutationOptions(ok)),
        setFile: useMutation(trpc.contracts.setFile.mutationOptions(okOrToast)),
        refresh,
        fail,
    }
}
