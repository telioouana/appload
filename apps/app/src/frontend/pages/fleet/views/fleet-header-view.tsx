"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconLink, IconPlus, IconTruck, IconTruckLoading, type Icon } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@/components/list/page-header"
import { RegisterVehicleDialog } from "@/frontend/pages/fleet/sections/register-vehicle-dialog"
import { KIND_SLUGS, SLUG_FOR_KIND, type KindSlug, type VehicleKind } from "@/frontend/pages/fleet/types"

const KIND_ICON: Record<VehicleKind, Icon> = {
    truck: IconTruck,
    trailer: IconTruckLoading,
    link: IconLink,
}

const KIND_ORDER = Object.entries(KIND_SLUGS) as [KindSlug, VehicleKind][]

export function FleetHeaderView({ kind }: { kind: VehicleKind }) {
    const t = useTranslations("App.fleet")
    const trpc = useTRPC()

    const [registerOpen, setRegisterOpen] = useState(false)

    // The record count for the title pill, read from the same stats the tiles
    // show, so the two can never disagree
    const stats = useQuery(trpc.fleet.vehicles.stats.queryOptions({ kind }))

    return (
        <>
            <PageHeader
                eyebrow={[t("eyebrow"), t(`title.${kind}`)]}
                title={t(`title.${kind}`)}
                count={stats.data?.total}
                description={t(`description.${kind}`)}
                search={{
                    placeholder: t("filters.search"),
                    clearLabel: t("filters.clear"),
                }}
                below={
                    // The three kinds are three routes rather than a filter, so
                    // this is a set of links: each one is addressable, and a
                    // shared URL opens the fleet the sender was looking at
                    <div className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
                        {KIND_ORDER.map(([slug, value]) => {
                            const Icon = KIND_ICON[value]
                            const active = value === kind

                            return (
                                <Link
                                    key={slug}
                                    href={{ pathname: "/fleet/[kind]", params: { kind: SLUG_FOR_KIND[value] } }}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "text-muted-foreground flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                                        active && "bg-background text-foreground font-medium shadow-sm",
                                    )}
                                >
                                    <Icon className="size-3.5" stroke={1.5} />
                                    {t(`kind.${value}`)}
                                </Link>
                            )
                        })}
                    </div>
                }
                actions={
                    <Button onClick={() => setRegisterOpen(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t(`add.${kind}`)}
                    </Button>
                }
            />

            <RegisterVehicleDialog kind={kind} open={registerOpen} onOpenChange={setRegisterOpen} />
        </>
    )
}
