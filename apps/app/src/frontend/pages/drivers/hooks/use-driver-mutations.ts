"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"

/**
 * The driver writes the list rows, the profile panel and the picker share.
 * Both feature trees are refreshed on success for the same reason the fleet
 * mutations refresh both: an assignment shows on either list.
 */
export function useDriverMutations() {
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: trpc.drivers.pathKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() })
    }

    const registerDriver = useMutation(trpc.drivers.register.mutationOptions({ onSuccess: refresh }))
    const updateDriver = useMutation(trpc.drivers.update.mutationOptions({ onSuccess: refresh }))
    const assignDriver = useMutation(trpc.fleet.assignDriver.mutationOptions({ onSuccess: refresh }))

    return { registerDriver, updateDriver, assignDriver, refresh }
}
