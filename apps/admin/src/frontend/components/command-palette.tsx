"use client"

import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { IconBuilding, IconBuildingFactory2, IconMap2, IconPackage, IconSearch, IconSteeringWheel, IconTruck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Kbd } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command"

import { useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { COMMAND_EVENT } from "@/components/list/page-header"
import { initials, PlateChip } from "@/components/list/table-cells"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"

/**
 * ⌘K from anywhere: an order, a company, a driver or a plate, straight to
 * its sheet. Mounted once in the protected layout; the list pages' search
 * boxes open it through a window event so they need no shared state.
 */
export function CommandPalette() {
    const t = useTranslations("Admin.command")
    const trpc = useTRPC()
    const router = useRouter()

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
        ...trpc.partners.search.queryOptions({ query: term }, { placeholderData: keepPreviousData }),
        enabled: open && ready,
    })
    // Orders live behind their own permission, so they are their own query
    const orders = useQuery({
        ...trpc.orders.search.queryOptions({ query: term }, { placeholderData: keepPreviousData }),
        enabled: open && ready,
    })

    const go = (pathname: "/orders/all" | "/map" | "/shippers" | "/carriers/all" | "/carriers/drivers" | "/carriers/fleets", params: Record<string, string>) => {
        setOpen(false)
        setQuery("")
        router.push({ pathname, query: params })
    }

    const results = search.data
    const orderHits = orders.data ?? []
    const nothing = ready && !search.isFetching && !orders.isFetching && results
        && results.organizations.length === 0 && results.drivers.length === 0 && results.vehicles.length === 0 && orderHits.length === 0

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

                    {orderHits.length > 0 && (
                        <CommandGroup heading={t("groups.orders")}>
                            {orderHits.map((order) => (
                                <CommandItem key={order.id} value={`order-${order.id}`} onSelect={() => go("/orders/all",{ id: order.orderId })} className="gap-3">
                                    <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                                        <IconPackage className="size-3.5" stroke={1.5} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{order.orderId}</span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {[order.shipperName, `${place(order.loadingAddress)} → ${place(order.offloadingAddress)}`].join(" · ")}
                                        </span>
                                    </span>
                                    <OrderStatusBadge status={order.status} className="px-1.5 py-0.5 text-xs" />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.organizations.length > 0 && (
                        <CommandGroup heading={t("groups.organizations")}>
                            {results.organizations.map((organization) => (
                                <CommandItem
                                    key={organization.id}
                                    value={`org-${organization.id}`}
                                    onSelect={() => go(organization.type === "shipper" ? "/shippers" : "/carriers/all", { id: organization.id })}
                                    className="gap-3"
                                >
                                    <Avatar className="size-7">
                                        <AvatarFallback className="text-[10px] font-medium">{initials(organization.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{organization.name}</span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {organization.type === "shipper" ? t("shipper") : t("carrier")}
                                            {organization.city ? ` · ${organization.city}` : ""}
                                        </span>
                                    </span>
                                    <KycBadge status={organization.kycStatus} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.drivers.length > 0 && (
                        <CommandGroup heading={t("groups.drivers")}>
                            {results.drivers.map((driver) => (
                                <CommandItem key={driver.id} value={`driver-${driver.id}`} onSelect={() => go("/carriers/drivers", { id: driver.id })} className="gap-3">
                                    <Avatar className="size-7">
                                        <AvatarFallback className="text-[10px] font-medium">{initials(driver.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{driver.name}</span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {[driver.carrierName, driver.plate].filter(Boolean).join(" · ")}
                                        </span>
                                    </span>
                                    <KycBadge status={driver.kycStatus} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {results && results.vehicles.length > 0 && (
                        <CommandGroup heading={t("groups.vehicles")}>
                            {results.vehicles.map((vehicle) => (
                                <CommandItem
                                    key={`${vehicle.kind}-${vehicle.id}`}
                                    value={`vehicle-${vehicle.id}`}
                                    onSelect={() => go("/carriers/fleets", vehicle.kind === "truck" ? { id: vehicle.id } : { kind: vehicle.kind, id: vehicle.id })}
                                    className="gap-3"
                                >
                                    <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                                        <IconTruck className="size-3.5" stroke={1.5} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <PlateChip plate={vehicle.regPlate} />
                                        <span className="text-muted-foreground truncate text-xs">
                                            {vehicle.brand} {vehicle.model}{vehicle.carrierName ? ` · ${vehicle.carrierName}` : ""}
                                        </span>
                                    </span>
                                    <KycBadge status={vehicle.kycStatus} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {ready && (
                        <CommandGroup heading={t("groups.actions")}>
                            <CommandItem value="search-orders" onSelect={() => go("/orders/all",{ search: term })} className="gap-3">
                                <IconPackage className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.orders") })}
                            </CommandItem>
                            {/* The map reads its own `q` param, not the lists' `search` */}
                            <CommandItem value="search-map" onSelect={() => go("/map", { q: term })} className="gap-3">
                                <IconMap2 className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.map") })}
                            </CommandItem>
                            <CommandItem value="search-shippers" onSelect={() => go("/shippers", { search: term })} className="gap-3">
                                <IconBuildingFactory2 className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.shippers") })}
                            </CommandItem>
                            <CommandItem value="search-carriers" onSelect={() => go("/carriers/all", { search: term })} className="gap-3">
                                <IconBuilding className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.carriers") })}
                            </CommandItem>
                            <CommandItem value="search-drivers" onSelect={() => go("/carriers/drivers", { search: term })} className="gap-3">
                                <IconSteeringWheel className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.drivers") })}
                            </CommandItem>
                            <CommandItem value="search-fleet" onSelect={() => go("/carriers/fleets", { search: term })} className="gap-3">
                                <IconSearch className="size-4" stroke={1.5} />
                                {t("search-in", { query: term, page: t("pages.fleet") })}
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
