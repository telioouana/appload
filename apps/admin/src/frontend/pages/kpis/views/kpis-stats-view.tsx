"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCash, IconClockCheck, IconTruck, IconUsers } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { MetricTile } from "@/frontend/pages/metrics/components/metric-tile"
import { useKpiParams } from "@/frontend/pages/kpis/hooks/use-kpi-params"
import { usePeriodLabel } from "@/frontend/pages/kpis/hooks/use-period-label"
import { statsInput } from "@/frontend/pages/kpis/types"

/**
 * The period at a glance, above the ranking that takes it apart: how many
 * partners moved something, how much work that was, what it was worth and
 * whether it arrived on time.
 *
 * The figures cover the whole period rather than the page on screen — a tile
 * that changed when you turned a page would be measuring the pagination — so
 * they come from the stats query, not from the rows below.
 *
 * Money is USD, converted per trip at its own loading-day rate; the header
 * line says so once for the whole page.
 */
export function KpisStatsView() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { period } = useKpiParams()

    const label = usePeriodLabel(period)

    const { data: stats } = useSuspenseQuery(
        trpc.kpis.stats.queryOptions(statsInput((key) => searchParams.get(key))),
    )

    const round = (value: number) => f.number(value, { maximumFractionDigits: 0 })
    const percent = (value: number | null) =>
        value === null ? "—" : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            <MetricTile
                Icon={IconUsers}
                label={t("stats.partners")}
                value={round(stats.partners)}
                hint={t("stats.partners-hint", { period: label })}
            />

            <MetricTile
                Icon={IconTruck}
                label={t("stats.transports")}
                value={round(stats.transports)}
                hint={t("stats.transports-hint", { deliveries: stats.deliveries })}
            />

            <MetricTile
                Icon={IconCash}
                label={t("stats.total")}
                value={round(stats.total)}
                hint={t("stats.total-hint", { km: round(stats.km) })}
            />

            <MetricTile
                Icon={IconClockCheck}
                label={t("stats.on-time")}
                value={percent(stats.onTimeOffloadingRate)}
                hint={t("stats.on-time-hint", { loading: percent(stats.onTimeLoadingRate) })}
            />
        </div>
    )
}
