"use client"

import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { IconBuilding, IconPackage, IconSearch, IconSteeringWheel, IconTruck, IconUsersGroup } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Kbd } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command"

import { useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value"
import { COMMAND_EVENT } from "@workspace/ui/customs/list/command"
import { initials, PlateChip } from "@workspace/ui/customs/list/table-cells"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { SLUG_FOR_KIND, type KindSlug } from "@/frontend/pages/fleet/types"
import { LaneCell, MovementStatusChip } from "@/frontend/pages/movements/components/badges"
import type { MovementTab } from "@/frontend/pages/movements/types"
import type { PartnerListKind } from "@/frontend/pages/partners/types"

/** Everywhere the palette can send the reader. */
type PaletteLink =
    | { pathname: "/orders/load/[loadId]"; params: { loadId: string } }
    | { pathname: "/orders/[section]"; params: { section: string }; query: { tab: MovementTab; search: string } }
    | { pathname: "/partners/[kind]"; params: { kind: PartnerListKind }; query: { id: string } | { search: string } }
    | { pathname: "/drivers"; query: { id: string } | { search: string } }
    | { pathname: "/fleet/[kind]"; params: { kind: KindSlug }; query: { id: string } | { search: string } }

/**
 * ⌘K from anywhere in the portal: a load, a partner, a driver or a plate,
 * straight to its page or its sheet. Loads come first — they are what a
 * company opens the portal for, and everything else is how one is run.
 *
 * Mounted once in the protected layout; the list pages' search boxes open it
 * through a window event, so they need no shared state. The company type
 * comes from the layout, like the rail's, rather than from a session query
 * observed above the pages' hydration.
 */
export function CommandPalette({ orgType }: { orgType: "shipper" | "carrier" }) {
    const t = useTranslations("App.search")
    const trpc = useTRPC()
    const router = useRouter()

    const carrier = orgType === "carrier"

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const debounced = useDebouncedValue(query, 250)

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault()
                setOpen((current) => !current)
            }
        }
        const onCommand = () => setOpen(true)

        window.addEventListener("keydown", onKey)
        window.addEventListener(COMMAND_EVENT, onCommand)

        return () => {
            window.removeEventListener("keydown", onKey)
            window.removeEventListener(COMMAND_EVENT, onCommand)
        }
    }, [])

    const term = debounced.trim()
    const ready = term.length >= 2

    const search = useQuery({
        ...trpc.search.global.queryOptions({ query: term }, { placeholderData: keepPreviousData }),
        enabled: open && ready,
    })

    const go = (link: PaletteLink) => {
        setOpen(false)
        setQuery("")
        router.push(link)
    }

    const results = search.data
    const nothing = ready && !search.isFetching && results
        && results.loads.length === 0 && results.partners.length === 0
        && results.drivers.length === 0 && results.vehicles.length === 0

    return (
        <CommandDialog open={open} onOpenChange={setOpen} title={t("title")} description={t("description")} className="sm:max-w-xl">
            <Command shouldFilter={false}>
                <CommandInput value={query} onValueChange={setQuery} placeholder={t("placeholder")} />
                <CommandList className="max-h-[420px]">
                    {!ready && <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t("typing")}</p>}
                    {ready && search.isFetching && !results && (
                        <div className="flex justify-center py-6"><Spinner className="text-primary" /></div>
                    )}
                    {nothing && <CommandEmpty>{t("empty")}</CommandEmpty>}

                    {results && results.loads.length > 0 && (
                        <CommandGroup heading={t("groups.loads")}>
                            {results.loads.map((load) => (
                                <CommandItem
                                    key={load.id}
                                    value={`load-${load.id}`}
                                    onSelect={() => go({ pathname: "/orders/load/[loadId]", params: { loadId: load.id } })}
                                    className="gap-3"
                                >
                                    <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                                        <IconPackage className="size-3.5" stroke={1.5} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{load.ref}</span>
                                        <LaneCell origin={load.origin} destination={load.destination} />
                                    </span>
                                    <MovementStatusChip status={load.status} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.partners.length > 0 && (
                        <CommandGroup heading={t("groups.partners")}>
                            {results.partners.map((partner) => (
                                <CommandItem
                                    key={partner.id}
                                    value={`partner-${partner.id}`}
                                    // A shipper is a carrier's client; every other partner is a transporter
                                    onSelect={() => go({
                                        pathname: "/partners/[kind]",
                                        params: { kind: carrier && partner.type === "shipper" ? "clients" : "transporters" },
                                        query: { id: partner.id },
                                    })}
                                    className="gap-3"
                                >
                                    <Avatar className="size-7">
                                        <AvatarFallback className="text-[10px] font-medium">{initials(partner.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="truncate font-medium">{partner.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.drivers.length > 0 && (
                        <CommandGroup heading={t("groups.drivers")}>
                            {results.drivers.map((driver) => (
                                <CommandItem
                                    key={driver.id}
                                    value={`driver-${driver.id}`}
                                    onSelect={() => go({ pathname: "/drivers", query: { id: driver.id } })}
                                    className="gap-3"
                                >
                                    <Avatar className="size-7">
                                        <AvatarFallback className="text-[10px] font-medium">{initials(driver.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{driver.name}</span>
                                        {driver.phone && <span className="text-muted-foreground truncate text-xs">{driver.phone}</span>}
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.vehicles.length > 0 && (
                        <CommandGroup heading={t("groups.vehicles")}>
                            {results.vehicles.map((vehicle) => (
                                <CommandItem
                                    key={`${vehicle.kind}-${vehicle.id}`}
                                    value={`vehicle-${vehicle.kind}-${vehicle.id}`}
                                    onSelect={() => go({
                                        pathname: "/fleet/[kind]",
                                        params: { kind: SLUG_FOR_KIND[vehicle.kind] },
                                        query: { id: vehicle.id },
                                    })}
                                    className="gap-3"
                                >
                                    <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                                        <IconTruck className="size-3.5" stroke={1.5} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <PlateChip plate={vehicle.plate} />
                                        <span className="text-muted-foreground truncate text-xs">{t(`kind.${vehicle.kind}`)}</span>
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {/* The escape hatch: the same words, in the page that pages
                        them — the palette shows the best few, never a list */}
                    {ready && (
                        <CommandGroup heading={t("groups.actions")}>
                            {/* The Orders page's two tabs: the company's own trucks,
                                and what its partners move for it */}
                            <CommandItem value="search-own" onSelect={() => go({ pathname: "/orders/[section]", params: { section: "all" }, query: { tab: "own", search: term } })} className="gap-3">
                                <IconPackage className="size-4" stroke={1.5} />
                                {t("actions.own")}
                            </CommandItem>
                            <CommandItem value="search-orders" onSelect={() => go({ pathname: "/orders/[section]", params: { section: "all" }, query: { tab: "partners", search: term } })} className="gap-3">
                                <IconUsersGroup className="size-4" stroke={1.5} />
                                {t(carrier ? "actions.orders-partners" : "actions.orders-transporters")}
                            </CommandItem>
                            {/* A carrier's partners are two lists, its clients and its transporters */}
                            <CommandItem value="search-partners" onSelect={() => go({ pathname: "/partners/[kind]", params: { kind: carrier ? "clients" : "transporters" }, query: { search: term } })} className="gap-3">
                                <IconBuilding className="size-4" stroke={1.5} />
                                {t("actions.partners")}
                            </CommandItem>
                            {carrier && (
                                <CommandItem value="search-transporters" onSelect={() => go({ pathname: "/partners/[kind]", params: { kind: "transporters" }, query: { search: term } })} className="gap-3">
                                    <IconTruck className="size-4" stroke={1.5} />
                                    {t("actions.transporters")}
                                </CommandItem>
                            )}
                            <CommandItem value="search-drivers" onSelect={() => go({ pathname: "/drivers", query: { search: term } })} className="gap-3">
                                <IconSteeringWheel className="size-4" stroke={1.5} />
                                {t("actions.drivers")}
                            </CommandItem>
                            <CommandItem value="search-fleet" onSelect={() => go({ pathname: "/fleet/[kind]", params: { kind: "trucks" }, query: { search: term } })} className="gap-3">
                                <IconSearch className="size-4" stroke={1.5} />
                                {t("actions.fleet")}
                            </CommandItem>
                        </CommandGroup>
                    )}
                </CommandList>

                <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-xs">
                    <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t("hints.move")}</span>
                    <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> {t("hints.open")}</span>
                    <span className="ml-auto inline-flex items-center gap-1"><Kbd>esc</Kbd> {t("hints.close")}</span>
                </div>
            </Command>
        </CommandDialog>
    )
}
