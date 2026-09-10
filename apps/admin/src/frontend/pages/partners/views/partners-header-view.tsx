"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconLink, IconPlus, IconTruck, IconTruckLoading, type Icon } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { RegisterPartnerDialog, type RegisterTarget } from "@/frontend/pages/partners/sections/register-partner"
import { currentKind, VEHICLE_KINDS, type VehicleKind } from "@/frontend/pages/partners/types"

type Page = "shippers" | "carriers" | "drivers" | "fleet"

const SEARCH_SCOPE: Record<Page, "organization" | "driver" | "fleet"> = {
    shippers: "organization",
    carriers: "organization",
    drivers: "driver",
    fleet: "fleet",
}

const KIND_ICON: Record<VehicleKind, Icon> = {
    truck: IconTruck,
    trailer: IconTruckLoading,
    link: IconLink,
}

/** The record count for the title pill, read from the same stats the tiles show. */
function useTotal(page: Page, kind: VehicleKind) {
    const trpc = useTRPC()

    const organizations = useQuery({
        ...trpc.partners.organizationStats.queryOptions({ type: page === "shippers" ? "shipper" : "carrier" }),
        enabled: page === "shippers" || page === "carriers",
    })
    const drivers = useQuery({ ...trpc.partners.driverStats.queryOptions(), enabled: page === "drivers" })
    const vehicles = useQuery({ ...trpc.partners.vehicleStats.queryOptions({ kind }), enabled: page === "fleet" })

    if (page === "drivers") return drivers.data?.total
    if (page === "fleet") return vehicles.data?.total
    return organizations.data?.total
}

export function PartnersHeaderView({ page }: { page: Page }) {
    const t = useTranslations("Admin.partners")
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const [registerOpen, setRegisterOpen] = useState(false)

    // Trucks, trailers and links share one page — the kind is a filter, not
    // a route, so switching does not remount the page or lose the search
    const kind = currentKind((key) => searchParams.get(key))
    const total = useTotal(page, kind)

    const target: RegisterTarget =
        page === "shippers" ? { kind: "organization", type: "shipper" }
            : page === "carriers" ? { kind: "organization", type: "carrier" }
                : page === "drivers" ? { kind: "driver" }
                    : { kind: "vehicle", vehicle: kind }

    const eyebrow = page === "shippers" || page === "carriers"
        ? [t("eyebrow.management"), t(`${page}.title`)]
        : [t("eyebrow.management"), t("carriers.title"), t(`${page}.title`)]

    return (
        <>
            <PageHeader
                eyebrow={eyebrow}
                title={t(`${page}.title`)}
                count={total}
                description={t(`${page}.description`)}
                search={{
                    placeholder: t(`filters.search.${SEARCH_SCOPE[page]}`),
                    clearLabel: t("filters.clear"),
                }}
                below={page === "fleet" ? (
                    <div role="radiogroup" className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
                        {VEHICLE_KINDS.map((value) => {
                            const Icon = KIND_ICON[value]
                            const active = value === kind

                            return (
                                <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => set([
                                        { key: "kind", value: value === "truck" ? null : value },
                                        { key: "page", value: null },
                                        { key: "id", value: null },
                                        { key: "tab", value: null },
                                    ])}
                                    className={cn(
                                        "text-muted-foreground flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                                        active && "bg-background text-foreground font-medium shadow-sm",
                                    )}
                                >
                                    <Icon className="size-3.5" stroke={1.5} />
                                    {t(`fleet.kind.${value}`)}
                                </button>
                            )
                        })}
                    </div>
                ) : undefined}
                actions={
                    <Button onClick={() => setRegisterOpen(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t(`${page}.add`)}
                    </Button>
                }
            />

            <RegisterPartnerDialog
                target={target}
                open={registerOpen}
                onOpenChange={setRegisterOpen}
            />
        </>
    )
}
