"use client"

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";

import { ControlFunc } from "@workspace/ui/inputs/types";
import { SearchInput } from "@workspace/ui/inputs/search";

import { useTRPC } from "@/backend/api/client";
import { KycBadge } from "@/frontend/pages/partners/sections/badges";
import type { DriverOption } from "@/backend/api/routers/fleet";
import { RegisterDriverDialog } from "@/frontend/pages/order/dialog/register-driver";

/**
 * Type-to-search input backed by the carrier's registered drivers. The
 * bound form field holds the driver's name; the matched driver (with
 * contact and passport, for auto-fill) is reported through `onSelect`
 * (cleared whenever the text stops matching a selection). Disabled until a
 * carrier is chosen — drivers belong to a carrier. Unmatched names offer
 * inline registration.
 */
export const DriverInput: ControlFunc<{
    carrierId?: string,
    onSelect: (driver?: DriverOption) => void,
}> = ({
    carrierId,
    onSelect,
    ...props
}) => {
        const t = useTranslations("Admin.driver")
        const trpc = useTRPC()

        // SearchInput debounces typing before onQueryChange fires
        const [query, setQuery] = useState("")

        // Registered drivers arrive through search results or the register
        // dialog; selections only carry the id, so keep the full objects
        const known = useRef(new Map<string, DriverOption>())

        const search = useQuery(
            trpc.fleet.searchDrivers.queryOptions(
                { carrierId: carrierId ?? "", query },
                { placeholderData: keepPreviousData, enabled: Boolean(carrierId) },
            ),
        )

        const results = useMemo(() => (carrierId ? search.data : undefined) ?? [], [carrierId, search.data])
        const isLoading = Boolean(carrierId) && (search.isPending || search.isFetching)

        useEffect(() => {
            for (const driver of results) {
                known.current.set(driver.id, driver)
            }
        }, [results])

        return (
            <SearchInput
                {...props}
                options={results.map((driver) => ({ id: driver.id, label: driver.name }))}
            renderOption={(option) => {
                const driver = known.current.get(option.id)
                if (!driver || driver.kycStatus === "verified") return null

                return (
                    <span className="ml-auto shrink-0">
                        <KycBadge status={driver.kycStatus} />
                    </span>
                )
            }}
                isLoading={isLoading}
                disabled={!carrierId}
                loadingText={t("combobox.loading")}
                emptyText={t("combobox.empty")}
                registerText={(name) => t("combobox.register", { name })}
                onQueryChange={setQuery}
                onSelect={(option) => onSelect(option && known.current.get(option.id))}
                renderRegister={({ query: name, open, close, apply }) => carrierId && (
                    <RegisterDriverDialog
                        carrierId={carrierId}
                        open={open}
                        initialName={name}
                        onOpenChange={(next) => { if (!next) close() }}
                        onRegistered={(driver) => {
                            known.current.set(driver.id, driver)
                            apply({ id: driver.id, label: driver.name })
                        }}
                    />
                )}
            />
        )
    }
