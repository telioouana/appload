"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { contractErrorKey } from "@/frontend/pages/contracts/lib/errors"

/**
 * The contract mutations the list, the page and the dialogs share. Every
 * success refreshes the whole contracts tree and the load form's options
 * (the shares a trip can be filed under come from them). Dialogs that show
 * their own error inline pass `onError` and get no toast.
 */
export function useContractMutations() {
    const t = useTranslations("App.contracts")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.contracts.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.movements.formOptions.queryKey() }),
    ])

    const fail = (error: unknown) => toast.error(t(`errors.${contractErrorKey(error)}`))

    const create = useMutation(trpc.contracts.create.mutationOptions({ onSuccess: () => { void refresh() } }))
    const update = useMutation(trpc.contracts.update.mutationOptions({ onSuccess: () => { void refresh() } }))
    const transition = useMutation(trpc.contracts.transition.mutationOptions({ onSuccess: () => { void refresh() }, onError: fail }))
    const setFile = useMutation(trpc.contracts.setFile.mutationOptions({ onSuccess: () => { void refresh() }, onError: fail }))
    const addAllocation = useMutation(trpc.contracts.allocations.add.mutationOptions({ onSuccess: () => { void refresh() } }))
    const updateAllocation = useMutation(trpc.contracts.allocations.update.mutationOptions({ onSuccess: () => { void refresh() } }))
    const removeAllocation = useMutation(trpc.contracts.allocations.remove.mutationOptions({ onSuccess: () => { void refresh() }, onError: fail }))

    return { create, update, transition, setFile, addAllocation, updateAllocation, removeAllocation, refresh, fail }
}
