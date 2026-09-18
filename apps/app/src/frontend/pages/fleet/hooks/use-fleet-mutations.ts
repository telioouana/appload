"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"

/**
 * The fleet writes the list rows, the profile panel and the pickers share.
 *
 * Every success refreshes both feature trees: a driver moving onto a truck
 * changes a row on the vehicles list and a row on the drivers list, and the
 * two counts must never disagree about it.
 */
export function useFleetMutations() {
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.drivers.pathKey() })
    }

    const registerVehicle = useMutation(trpc.fleet.vehicles.register.mutationOptions({ onSuccess: refresh }))
    const updateVehicle = useMutation(trpc.fleet.vehicles.update.mutationOptions({ onSuccess: refresh }))
    const assignDriver = useMutation(trpc.fleet.assignDriver.mutationOptions({ onSuccess: refresh }))

    return { registerVehicle, updateVehicle, assignDriver, refresh }
}
