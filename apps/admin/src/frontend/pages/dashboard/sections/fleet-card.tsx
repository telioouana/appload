"use client"

import { useCallback, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight, IconMapPin } from "@tabler/icons-react"

import { useNow, useTranslations } from "@workspace/i18n"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { FleetMapLazy } from "@/frontend/pages/dashboard/components/fleet-map.lazy"
import { FleetList } from "@/frontend/pages/dashboard/sections/fleet-list"
import { OVERVIEW_POLL_MS } from "@/frontend/pages/map/types"

/**
 * Where the fleet is, right now: the same polled overview the map page runs
 * on, drawn as a map with its index beside it.
 *
 * The selection is local state, not `?order=` — the dashboard already spends
 * its URL on the year and the order sheet, and a pin opened here is a glance,
 * not a destination. "Open map" carries it over to `/map`, which does keep
 * the selection in the URL.
 *
 * The count on the header is `map.overview`'s own length (every tracked load,
 * whatever its year), which is what the link opens — the "On the road" tile
 * above counts this year's section and links there instead.
 */
export function FleetCard() {
    const t = useTranslations("Admin.dashboard")
    const trpc = useTRPC()

    // Explicit now keeps `relativeTime` warning-free and ticks every label in
    // the list over together, once a minute
    const now = useNow({ updateInterval: 60_000 })

    const [selected, setSelected] = useState<string | null>(null)

    const { data: orders } = useSuspenseQuery(
        trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }),
    )

    // Clicking the open truck again closes it, from the pin or from the row
    const onSelect = useCallback(
        (orderId: string) => setSelected((current) => (current === orderId ? null : orderId)),
        [],
    )

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                    {t("fleet.title")}
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums">
                        {orders.length}
                    </span>
                </h2>

                <Link
                    href={{ pathname: "/map", query: selected ? { order: selected } : undefined }}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
                >
                    {t("open-map")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {orders.length === 0 ? (
                <Empty className="h-64 lg:h-[420px]">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconMapPin />
                        </EmptyMedia>
                        <EmptyTitle>{t("fleet.empty-title")}</EmptyTitle>
                        <EmptyDescription>{t("fleet.empty-description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                    {/* The map fills a fixed box: the page scrolls behind this
                        card, so a canvas sized by its content would collapse */}
                    <div className="relative h-64 lg:h-[420px]">
                        <FleetMapLazy
                            orders={orders}
                            selected={selected}
                            onSelect={onSelect}
                            onClose={() => setSelected(null)}
                        />
                    </div>

                    <FleetList orders={orders} selected={selected} onSelect={onSelect} now={now} />
                </div>
            )}
        </section>
    )
}
