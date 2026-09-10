"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
    IconAlertTriangle,
    IconCalendarClock,
    IconClockCheck,
    IconHourglass,
    IconLeaf,
    IconPackageOff,
    IconTruckReturn,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { KpiTile } from "@/frontend/pages/analytics/components/kpi-tile"
import { analyticsInput } from "@/frontend/pages/analytics/types"

/**
 * How the period actually went, once the money is set aside: punctuality,
 * how long a transport took, what it was held up by and what came back on a
 * return leg. These are the indicators of Claire's KPI sheet, counted over
 * the company's own transports.
 *
 * A rate with an empty divisor arrives as `null` and prints as a dash, never
 * as a zero — an on-time rate of 0% and no transports at all are not the
 * same news. A period with nothing in it says so instead of showing seven
 * dashes.
 */
export function KpiTiles() {
    const t = useTranslations("App.analytics")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const { data } = useSuspenseQuery(trpc.analytics.kpis.queryOptions(analyticsInput(get)))

    const kpis = data.figures
    const none = t("none")

    const percent = (value: number | null) =>
        value === null ? none : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    const whole = (value: number | null) => (value === null ? none : f.number(value, { maximumFractionDigits: 0 }))

    const incidents = kpis.accidents + kpis.mechanical + kpis.documentation + kpis.police

    return (
        <>
            <h2 className="px-2 text-sm font-medium">{t("kpis.title")}</h2>

            {kpis.transports === 0 ? (
                <p className="text-muted-foreground px-2 text-sm">{t("kpis.empty")}</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
                    <KpiTile
                        Icon={IconClockCheck}
                        label={t("kpis.tiles.on-time")}
                        value={percent(kpis.onTimeOffloadingRate)}
                        hint={t("kpis.tiles.on-time-hint", { loading: percent(kpis.onTimeLoadingRate) })}
                    />

                    <KpiTile
                        Icon={IconCalendarClock}
                        label={t("kpis.tiles.days")}
                        value={
                            kpis.avgTravelDays === null
                                ? none
                                : t("kpis.days-value", { days: f.number(kpis.avgTravelDays, { maximumFractionDigits: 1 }) })
                        }
                        // The average is taken over the trips that recorded
                        // both dates, so the sample it rests on is named
                        hint={t("kpis.tiles.days-hint", {
                            count: f.number(kpis.travelDaysTrips),
                            total: f.number(kpis.transports),
                        })}
                    />

                    <KpiTile
                        Icon={IconHourglass}
                        label={t("kpis.tiles.demurrage")}
                        value={percent(kpis.demurrageRate)}
                        hint={t("kpis.tiles.demurrage-hint", { days: kpis.demurrageDays })}
                    />

                    <KpiTile
                        Icon={IconAlertTriangle}
                        label={t("kpis.tiles.incidents")}
                        value={f.number(incidents)}
                        hint={t("kpis.tiles.incidents-hint", { days: kpis.delayDays })}
                    />

                    <KpiTile
                        Icon={IconPackageOff}
                        label={t("kpis.tiles.damage")}
                        value={percent(kpis.damageRate)}
                        hint={t("kpis.tiles.damage-hint", { claims: percent(kpis.claimRate) })}
                    />

                    <KpiTile
                        Icon={IconLeaf}
                        label={t("kpis.tiles.co2")}
                        value={whole(kpis.co2)}
                        hint={t("kpis.tiles.co2-hint")}
                    />

                    <KpiTile
                        Icon={IconTruckReturn}
                        label={t("kpis.tiles.backload")}
                        value={percent(kpis.backloadShare)}
                        hint={t("kpis.tiles.backload-hint", { count: kpis.backloadTrips })}
                    />
                </div>
            )}
        </>
    )
}
