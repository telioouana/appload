"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import type { ControlFunc } from "@workspace/ui/inputs/types"
import { SearchInput } from "@workspace/ui/inputs/search"

import { useTRPC } from "@/backend/api/client"
import { KycBadge, OwnershipBadge } from "@/frontend/pages/fleet/sections/badges"
import type { VehicleOption } from "@/frontend/pages/fleet/server/procedures"
import { RegisterVehicleDialog } from "@/frontend/pages/fleet/sections/register-vehicle-dialog"
import type { VehicleKind } from "@/backend/schemas/register-fleet"

/**
 * Type-to-search input backed by the signed-in carrier's own vehicles of one
 * kind. The bound form field holds the plate; the matched vehicle (with its
 * id and year) is reported through `onSelect`, cleared whenever the text
 * stops matching a selection. Unmatched plates offer inline registration.
 *
 * Unlike Admin's picker there is no carrier to pass: the tenant IS the
 * carrier, and `fleet.vehicles.search` scopes itself to it.
 */
export const FleetInput: ControlFunc<{
    kind: VehicleKind
    onSelect: (vehicle?: VehicleOption) => void
}> = ({ kind, onSelect, ...props }) => {
    const t = useTranslations("App.fleet")
    const trpc = useTRPC()

    // SearchInput debounces typing before onQueryChange fires
    const [query, setQuery] = useState("")

    // Vehicles arrive through search results or the register dialog;
    // selections only carry the id, so keep the full objects
    const known = useRef(new Map<string, VehicleOption>())

    const search = useQuery(
        trpc.fleet.vehicles.search.queryOptions({ kind, query }, { placeholderData: keepPreviousData }),
    )

    const results = useMemo(() => search.data ?? [], [search.data])

    useEffect(() => {
        for (const vehicle of results) {
            known.current.set(vehicle.id, vehicle)
        }
    }, [results])

    return (
        <SearchInput
            {...props}
            options={results.map((vehicle) => ({ id: vehicle.id, label: vehicle.regPlate }))}
            // A third-party-owned or unverified vehicle is called out while it
            // is being chosen, not after the trip has been dispatched
            renderOption={(option) => {
                const vehicle = known.current.get(option.id)
                if (!vehicle) return null

                return (
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                        {vehicle.ownershipStatus !== "owner-verified" && (
                            <OwnershipBadge status={vehicle.ownershipStatus} />
                        )}
                        {vehicle.kycStatus !== "verified" && <KycBadge status={vehicle.kycStatus} />}
                    </span>
                )
            }}
            isLoading={search.isPending || search.isFetching}
            // Mozambican plates: trucks carry a 3-letter prefix, towed units 2
            inputMask={kind === "truck" ? "AAA 999 AA" : "AA 999 AA"}
            loadingText={t("combobox.loading")}
            emptyText={t("combobox.empty")}
            registerText={(plate) => t("combobox.register", { plate })}
            onQueryChange={setQuery}
            onSelect={(option) => onSelect(option && known.current.get(option.id))}
            renderRegister={({ query: plate, open, close, apply }) => (
                <RegisterVehicleDialog
                    kind={kind}
                    open={open}
                    initialPlate={plate}
                    onOpenChange={(next) => { if (!next) close() }}
                    onRegistered={(vehicle) => {
                        known.current.set(vehicle.id, vehicle)
                        apply({ id: vehicle.id, label: vehicle.regPlate })
                    }}
                />
            )}
        />
    )
}
