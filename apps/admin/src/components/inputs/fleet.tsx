"use client"

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";

import { ControlFunc } from "@workspace/ui/inputs/types";
import { SearchInput } from "@workspace/ui/inputs/search";

import { useTRPC } from "@/backend/api/client";
import { KycBadge, OwnershipBadge } from "@/frontend/pages/partners/sections/badges";
import type { VehicleOption } from "@/backend/api/routers/fleet";
import type { VehicleKind } from "@/backend/schemas/register-fleet";
import { RegisterVehicleDialog } from "@/frontend/pages/order/dialog/register-vehicle";

/**
 * Type-to-search input backed by the carrier's registered vehicles of one
 * kind. The bound form field holds the plate; the matched vehicle (with
 * year and loading bay, for derived fields) is reported through `onSelect`
 * (cleared whenever the text stops matching a selection). Disabled until a
 * carrier is chosen — the registry is carrier-scoped. Unmatched plates
 * offer inline registration.
 */
export const FleetInput: ControlFunc<{
    kind: VehicleKind,
    carrierId?: string,
    onSelect: (vehicle?: VehicleOption) => void,
}> = ({
    kind,
    carrierId,
    onSelect,
    ...props
}) => {
        const t = useTranslations("Admin.fleet")
        const trpc = useTRPC()

        // SearchInput debounces typing before onQueryChange fires
        const [query, setQuery] = useState("")

        // Registered vehicles arrive through search results or the register
        // dialog; selections only carry the id, so keep the full objects
        const known = useRef(new Map<string, VehicleOption>())

        const search = useQuery(
            trpc.fleet.searchVehicles.queryOptions(
                { kind, carrierId: carrierId ?? "", query },
                { placeholderData: keepPreviousData, enabled: Boolean(carrierId) },
            ),
        )

        const results = useMemo(() => (carrierId ? search.data : undefined) ?? [], [carrierId, search.data])
        const isLoading = Boolean(carrierId) && (search.isPending || search.isFetching)

        useEffect(() => {
            for (const vehicle of results) {
                known.current.set(vehicle.id, vehicle)
            }
        }, [results])

        return (
            <SearchInput
                {...props}
                options={results.map((vehicle) => ({ id: vehicle.id, label: vehicle.regPlate }))}
            // A third-party-owned or unverified vehicle is called out while
            // it is being chosen, not after the order is booked
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
                isLoading={isLoading}
                disabled={!carrierId}
                // Mozambican plates: trucks carry a 3-letter prefix, towed units 2
                inputMask={kind === "truck" ? "AAA 999 AA" : "AA 999 AA"}
                loadingText={t("combobox.loading")}
                emptyText={t("combobox.empty")}
                registerText={(plate) => t("combobox.register", { plate })}
                onQueryChange={setQuery}
                onSelect={(option) => onSelect(option && known.current.get(option.id))}
                renderRegister={({ query: plate, open, close, apply }) => carrierId && (
                    <RegisterVehicleDialog
                        kind={kind}
                        carrierId={carrierId}
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
