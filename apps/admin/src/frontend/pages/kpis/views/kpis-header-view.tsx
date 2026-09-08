"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@/components/list/page-header"
import { PeriodControl } from "@/frontend/pages/kpis/components/period-control"
import { useKpiParams } from "@/frontend/pages/kpis/hooks/use-kpi-params"
import { usePeriodLabel } from "@/frontend/pages/kpis/hooks/use-period-label"
import { statsInput } from "@/frontend/pages/kpis/types"

/**
 * The top of the KPI list: what the page is, how many partners it found, the
 * stretch they were counted over, and the box that narrows them by name.
 *
 * The count is the period's partner count rather than the page's length — the
 * pill beside a title says how much there is, not how much is on screen — so
 * it comes from the same stats query the tiles below read, prefetched with
 * the same builder and therefore already in hand.
 *
 * The period control sits under the title rather than beside the search: it
 * rewrites every figure on the page, which makes it the page's own control
 * and not one of the list's filters.
 */
export function KpisHeaderView() {
    const t = useTranslations("Admin.kpis")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { period } = useKpiParams()

    const label = usePeriodLabel(period)

    const { data: stats } = useSuspenseQuery(
        trpc.kpis.stats.queryOptions(statsInput((key) => searchParams.get(key))),
    )

    return (
        <PageHeader
            title={t("title")}
            count={stats.partners}
            description={t("description", { period: label })}
            search={{ placeholder: t("search"), clearLabel: t("clear") }}
            below={
                <div className="pt-1">
                    <PeriodControl />
                </div>
            }
        />
    )
}
