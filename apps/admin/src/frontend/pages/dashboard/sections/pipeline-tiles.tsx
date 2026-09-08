"use client"

import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { IconCalendarClock, IconFileCheck, IconLockOpen, IconTruckDelivery } from "@tabler/icons-react"

import { useNow, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { KpiTile } from "@/frontend/pages/dashboard/components/kpi-tile"
import { isSilent, tilesStatsInput } from "@/frontend/pages/dashboard/types"
import { OVERVIEW_POLL_MS } from "@/frontend/pages/map/types"
import { LOADING_WINDOW_DAYS } from "@/frontend/pages/orders/types"

/**
 * The four numbers the day starts with: quotes still to confirm, trucks due
 * at a loading site this week, loads on the road and deliveries whose proof
 * has not come back. Each one is the door to exactly the rows it counts.
 *
 * The counts are this year's, whatever year the chart below is showing — the
 * pipeline is always now. The line under each number is the fact that turns
 * a count into work: due to load, overdue, silent, waiting on paper.
 */
export function PipelineTiles() {
    const t = useTranslations("Admin.dashboard")
    const trpc = useTRPC()
    // Explicit now, ticking with the fleet poll, so "silent" ages by itself
    const now = useNow({ updateInterval: 60_000 })

    // The same staleTime the queue reads it with: two observers of one key
    // disagreeing would refetch the stats the moment the second one mounts
    const { data: stats } = useSuspenseQuery({ ...trpc.orders.stats.queryOptions(tilesStatsInput()), staleTime: 60_000 })

    // The fleet is a hint, never a blocker: the tiles paint with the counts
    // they already have and the silence line lands when the poll does
    const fleet = useQuery(trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }))

    const silent = fleet.data?.filter((order) => isSilent(order, now.getTime())).length

    // The trucks the map tracks, whatever year their order belongs to — the
    // same list the fleet card and the silent row count, so the four numbers
    // on the page agree. The section count stands in until the poll answers.
    const onRoad = fleet.data?.length ?? stats.bySection["on-going"]

    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            <KpiTile
                href={{ pathname: "/orders/prospect", query: { sort: "loading", dir: "asc" } }}
                Icon={IconLockOpen}
                label={t("tiles.prospects")}
                value={stats.bySection.prospect}
                hint={t("tiles.prospects-hint", { count: stats.pipeline.prospectsDueSoon, days: LOADING_WINDOW_DAYS })}
                tone={stats.pipeline.prospectsDueSoon > 0 ? "warn" : undefined}
            />

            <KpiTile
                href={{ pathname: "/orders/all", query: { loading: String(LOADING_WINDOW_DAYS) } }}
                Icon={IconCalendarClock}
                label={t("tiles.loading")}
                value={stats.attention.loading}
                hint={t("tiles.loading-hint", { count: stats.pipeline.loadingOverdue })}
                tone={stats.pipeline.loadingOverdue > 0 ? "warn" : undefined}
            />

            <KpiTile
                href="/map"
                Icon={IconTruckDelivery}
                label={t("tiles.on-road")}
                value={onRoad}
                // No line at all until the fleet answers: "every truck heard
                // from today" would be a claim we cannot make yet
                hint={silent === undefined ? undefined : t("tiles.on-road-hint", { count: silent })}
                tone={silent ? "warn" : undefined}
            />

            <KpiTile
                href={{ pathname: "/orders/all", query: { pod: "pending" } }}
                Icon={IconFileCheck}
                label={t("tiles.pod")}
                value={stats.attention.pod}
                hint={t("tiles.pod-hint")}
            />
        </div>
    )
}
