"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import type { ControlFunc } from "@workspace/ui/inputs/types"
import { SearchInput } from "@workspace/ui/inputs/search"

import { useTRPC } from "@/backend/api/client"
import { KycBadge } from "@/frontend/pages/fleet/sections/badges"
import type { DriverOption } from "@/frontend/pages/drivers/server/procedures"
import { RegisterDriverDialog } from "@/frontend/pages/drivers/sections/register-driver-dialog"

/**
 * Type-to-search input backed by the signed-in carrier's own drivers. The
 * bound form field holds the driver's name; the matched driver (with its id,
 * contact and passport) is reported through `onSelect`, cleared whenever the
 * text stops matching a selection. Unmatched names offer inline registration.
 *
 * Unlike Admin's picker there is no carrier to pass: the tenant IS the
 * carrier, and `drivers.search` scopes itself to it.
 */
export const DriverInput: ControlFunc<{
    onSelect: (driver?: DriverOption) => void
}> = ({ onSelect, ...props }) => {
    const t = useTranslations("App.drivers")
    const trpc = useTRPC()

    // SearchInput debounces typing before onQueryChange fires
    const [query, setQuery] = useState("")

    // Drivers arrive through search results or the register dialog;
    // selections only carry the id, so keep the full objects
    const known = useRef(new Map<string, DriverOption>())

    const search = useQuery(
        trpc.drivers.search.queryOptions({ query }, { placeholderData: keepPreviousData }),
    )

    const results = useMemo(() => search.data ?? [], [search.data])

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
            isLoading={search.isPending || search.isFetching}
            loadingText={t("combobox.loading")}
            emptyText={t("combobox.empty")}
            registerText={(name) => t("combobox.register", { name })}
            onQueryChange={setQuery}
            onSelect={(option) => onSelect(option && known.current.get(option.id))}
            renderRegister={({ query: name, open, close, apply }) => (
                <RegisterDriverDialog
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
