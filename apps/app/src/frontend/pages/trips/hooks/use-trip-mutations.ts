"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { planRefusal } from "@/components/plan-dialog"
import { tripErrorKey } from "@/frontend/pages/trips/lib/errors"

/**
 * The trip mutations the list, the panel and the detail page share.
 *
 * Every success refreshes the whole trips tree — a status change moves a row
 * between sections and changes two of the four tiles — so the lists and the
 * counts refetch together.
 *
 * Starting a trip is what a plan pays for: when the server answers with one
 * of the two plan codes the caller opens the plan dialog instead, and a
 * toast saying the same thing would only land on top of it.
 */
export function useTripMutations() {
    const t = useTranslations("App.trips")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.trips.pathKey() })

    const fail = (error: unknown) => toast.error(t(`errors.${tripErrorKey(error)}`))

    const planAware = (error: unknown) => { if (planRefusal(error) === null) fail(error) }

    const create = useMutation(trpc.trips.create.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t("toasts.created", { ref: data.ref })) },
        onError: planAware,
    }))

    const setStatus = useMutation(trpc.trips.setStatus.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t(`toasts.status.${data.status}`)) },
        onError: planAware,
    }))

    const requestLocation = useMutation(trpc.trips.requestLocation.mutationOptions({
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

    return { create, setStatus, requestLocation, refresh }
}
