"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"

/**
 * The edit mutations the list rows and the profile panel share, each
 * refreshing every partner query on success — a changed NUIT moves a row
 * out of the "incomplete" tile, so counts and lists must refetch together.
 */
export function usePartnerMutations() {
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() })

    const updateOrganization = useMutation(trpc.organizations.update.mutationOptions({ onSuccess: refresh }))
    const updateDriver = useMutation(trpc.fleet.updateDriver.mutationOptions({ onSuccess: refresh }))
    const updateVehicle = useMutation(trpc.fleet.updateVehicle.mutationOptions({ onSuccess: refresh }))
    const assignDriver = useMutation(trpc.fleet.assignDriver.mutationOptions({ onSuccess: refresh }))

    return { updateOrganization, updateDriver, updateVehicle, assignDriver, refresh }
}
