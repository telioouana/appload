"use client"

import { toast } from "sonner"
import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconTruck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@workspace/ui/components/command"

import { useTRPC } from "@/backend/api/client"
import { PlateChip } from "@workspace/ui/customs/list/table-cells"
import { KycBadge } from "@/frontend/pages/fleet/sections/badges"
import { useDriverMutations } from "@/frontend/pages/drivers/hooks/use-driver-mutations"

/**
 * Puts a driver on one of the carrier's own trucks, or takes them off it. The
 * lookup is tenant-scoped on the server, so a truck can only ever come from
 * the fleet the driver already belongs to.
 */
export function AssignTruckPopover({
    driverId,
    currentTruckId,
}: {
    driverId: string
    currentTruckId: string | null
}) {
    const t = useTranslations("App.drivers.assign")
    const trpc = useTRPC()
    const { assignDriver } = useDriverMutations()

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")

    const search = useQuery({
        ...trpc.fleet.vehicles.search.queryOptions({ kind: "truck", query }, { placeholderData: keepPreviousData }),
        enabled: open,
    })

    const pick = async (truckId: string | null) => {
        try {
            await assignDriver.mutateAsync({ driverId, truckId })
            toast.success(t("assigned"))
        } catch {
            toast.error(t("failed"))
        }
        setOpen(false)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                    <IconTruck className="size-4" stroke={1.5} />
                    {currentTruckId ? t("change-truck") : t("assign-truck")}
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
                                    <CommandItem
                                        value="__unassign"
                                        onSelect={() => pick(null)}
                                        disabled={assignDriver.isPending}
                                        className="text-destructive"
                                    >
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
