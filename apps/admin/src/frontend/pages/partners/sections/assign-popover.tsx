"use client"

import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconSteeringWheel, IconTruck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@workspace/ui/components/command"

import { useTRPC } from "@/backend/api/client"
import { PlateChip } from "@workspace/ui/customs/list/table-cells"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"

/**
 * Puts a driver on one of their carrier's trucks, or takes them off it.
 * Same lookup the order form uses, so a truck can only be picked from the
 * carrier the driver already belongs to.
 */
export function AssignTruckPopover({
    driverId,
    carrierId,
    currentTruckId,
    currentPlate,
}: {
    driverId: string
    carrierId: string
    currentTruckId: string | null
    currentPlate: string | null
}) {
    const t = useTranslations("Admin.partners.assign")
    const trpc = useTRPC()
    const { assignDriver } = usePartnerMutations()

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")

    const search = useQuery({
        ...trpc.fleet.searchVehicles.queryOptions({ kind: "truck", carrierId, query }, { placeholderData: keepPreviousData }),
        enabled: open,
    })

    const pick = async (truckId: string | null) => {
        await assignDriver.mutateAsync({ driverId, truckId })
        setOpen(false)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                    <IconTruck className="size-4" stroke={1.5} />
                    {currentPlate ? t("change-truck") : t("assign-truck")}
                    <IconChevronDown className="size-3.5" stroke={1.5} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
                <Command shouldFilter={false} className="rounded-3xl">
                    <CommandInput value={query} onValueChange={setQuery} placeholder={t("search-truck")} />
                    <CommandList>
                        {search.isFetching && (
                            <div className="flex justify-center py-3"><Spinner className="size-4" /></div>
                        )}
                        <CommandEmpty>{t("no-trucks")}</CommandEmpty>
                        <CommandGroup>
                            {(search.data ?? []).map((truck) => (
                                <CommandItem
                                    key={truck.id}
                                    value={truck.id}
                                    disabled={truck.id === currentTruckId || assignDriver.isPending}
                                    onSelect={() => pick(truck.id)}
                                    className="gap-3"
                                >
                                    <PlateChip plate={truck.regPlate} />
                                    <span className="text-muted-foreground flex-1 truncate text-xs">{truck.year ?? ""}</span>
                                    <KycBadge status={truck.kycStatus} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        {currentTruckId && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem value="__unassign" onSelect={() => pick(null)} disabled={assignDriver.isPending} className="text-destructive">
                                        <IconX className="size-4" stroke={1.5} />
                                        {t("unassign")}
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

/** Puts one of the carrier's drivers on this truck. */
export function AssignDriverPopover({ truckId, carrierId }: { truckId: string; carrierId: string }) {
    const t = useTranslations("Admin.partners.assign")
    const trpc = useTRPC()
    const { assignDriver } = usePartnerMutations()

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")

    const search = useQuery({
        ...trpc.fleet.searchDrivers.queryOptions({ carrierId, query }, { placeholderData: keepPreviousData }),
        enabled: open,
    })

    const pick = async (driverId: string) => {
        await assignDriver.mutateAsync({ driverId, truckId })
        setOpen(false)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                    <IconSteeringWheel className="size-4" stroke={1.5} />
                    {t("assign-driver")}
                    <IconChevronDown className="size-3.5" stroke={1.5} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
                <Command shouldFilter={false} className="rounded-3xl">
                    <CommandInput value={query} onValueChange={setQuery} placeholder={t("search-driver")} />
                    <CommandList>
                        {search.isFetching && (
                            <div className="flex justify-center py-3"><Spinner className="size-4" /></div>
                        )}
                        <CommandEmpty>{t("no-drivers")}</CommandEmpty>
                        <CommandGroup>
                            {(search.data ?? []).map((driver) => (
                                <CommandItem
                                    key={driver.id}
                                    value={driver.id}
                                    disabled={assignDriver.isPending}
                                    onSelect={() => pick(driver.id)}
                                    className="gap-3"
                                >
                                    <span className="flex-1 truncate">{driver.name}</span>
                                    <span className="text-muted-foreground text-xs">{driver.phoneNumber ?? ""}</span>
                                    <KycBadge status={driver.kycStatus} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
