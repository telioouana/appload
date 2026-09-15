"use client"

import { toast } from "sonner"
import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconSteeringWheel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command"

import { useTRPC } from "@/backend/api/client"
import { KycBadge } from "@/frontend/pages/fleet/sections/badges"
import { useFleetMutations } from "@/frontend/pages/fleet/hooks/use-fleet-mutations"

/**
 * Puts one of the carrier's own drivers on this truck. The lookup is the same
 * one the order form uses, and it is tenant-scoped on the server, so there is
 * no carrier to pass and no way to reach someone else's driver.
 */
export function AssignDriverPopover({ truckId, hasDriver }: { truckId: string; hasDriver: boolean }) {
    const t = useTranslations("App.fleet.assign")
    const trpc = useTRPC()
    const { assignDriver } = useFleetMutations()

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")

    const search = useQuery({
        ...trpc.drivers.search.queryOptions({ query }, { placeholderData: keepPreviousData }),
        enabled: open,
    })

    const pick = async (driverId: string) => {
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
                    <IconSteeringWheel className="size-4" stroke={1.5} />
                    {hasDriver ? t("change-driver") : t("assign-driver")}
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
