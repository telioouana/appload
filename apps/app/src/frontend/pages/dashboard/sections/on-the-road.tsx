"use client"

import { useCallback, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight, IconMapPin } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { OverviewMapLazy } from "@/frontend/pages/dashboard/components/overview-map.lazy"
import { OVERVIEW_POLL_MS } from "@/frontend/pages/map/types"

/**
 * Where the company's loads are, right now: the same polled overview the map
 * page runs on — its Appload orders in transit and the trips it tracks itself
 * — drawn as a block on the board.
 *
 * The open pin is local state, not `?id=`: a pin opened here is a glance, not
 * a destination. "Open map" carries it over to `/map`, which does keep the
 * selection in the URL.
 */
export function OnTheRoad() {
    const t = useTranslations("App.dashboard")
    const trpc = useTRPC()

    const [selected, setSelected] = useState<string | null>(null)

    const { data: entities } = useSuspenseQuery(
        trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }),
    )

    // Clicking the open movement again closes it
    const onSelect = useCallback(
        (ref: string) => setSelected((current) => (current === ref ? null : ref)),
        [],
    )

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                    {t("road.title")}
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums">
                        {entities.length.toLocaleString()}
                    </span>
                </h2>

                <Link
                    href={{ pathname: "/map", query: selected ? { id: selected } : undefined }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("open-map")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {entities.length === 0 ? (
                <Empty className="h-64 lg:h-[420px]">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconMapPin />
                        </EmptyMedia>
                        <EmptyTitle>{t("road.empty-title")}</EmptyTitle>
                        <EmptyDescription>{t("road.empty-description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                // The map fills a fixed box: the page scrolls behind this card,
                // so a canvas sized by its content would collapse
                <div className="relative h-64 lg:h-[420px]">
                    <OverviewMapLazy
                        entities={entities}
                        selected={selected}
                        onSelect={onSelect}
                        onClose={() => setSelected(null)}
                    />
                </div>
            )}
        </section>
    )
}
