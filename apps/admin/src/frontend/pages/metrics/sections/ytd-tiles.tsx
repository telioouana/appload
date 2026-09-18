"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCoins, IconPercentage, IconTruck, IconWallet } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { MetricTile } from "@/frontend/pages/metrics/components/metric-tile"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { overviewInput } from "@/frontend/pages/metrics/types"

/**
 * Where the business stands this year, against the same stretch of last one.
 * Sales is what shippers paid, commission is Appload's cut of it including
 * VAT, net revenue is that cut once the VAT is handed over — and trips is the
 * work behind all three.
 *
 * The year is only ever compared like for like: the procedure computes the
 * change against the previous year restricted to the months this one has, so
 * September never loses to a full December. The hint names that stretch so
 * nobody has to take it on trust.
 */
export function YtdTiles() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()
    const { currency, code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    // The year being lived in; a timeline that somehow stops earlier still
    // shows its last year rather than four empty tiles
    const thisYear = Number(data.currentMonth.slice(0, 4))
    const year = data.years.find((entry) => entry.year === thisYear) ?? data.years.at(-1)

    // The stretch the comparison covers: the months this year actually has,
    // which is what the previous year was cut down to on the server
    const lastMonth = year
        ? (data.months.filter((month) => month.year === year.year).at(-1)?.month ?? 12)
        : 12

    // Mid-month at UTC: Maputo is UTC+2, so the name can never slip a month
    const monthName = (month: number) => f.dateTime(new Date(Date.UTC(2000, month - 1, 15)), { month: "short" })

    const period = year
        ? year.partial
            ? `${monthName(1)}–${monthName(lastMonth)} ${year.year - 1}`
            : String(year.year - 1)
        : ""

    const money = (value: number) => f.number(value, { maximumFractionDigits: 0 })

    const tiles = [
        { key: "sales", Icon: IconCoins, label: t("tiles.sales", { currency: code }), value: money(year?.money[currency].sales ?? 0), delta: year?.yoy.sales },
        { key: "commission", Icon: IconPercentage, label: t("tiles.commission", { currency: code }), value: money(year?.money[currency].commission ?? 0), delta: year?.yoy.commission },
        { key: "net", Icon: IconWallet, label: t("tiles.net", { currency: code }), value: money(year?.money[currency].net ?? 0), delta: year?.yoy.net },
        { key: "trips", Icon: IconTruck, label: t("tiles.trips"), value: f.number(year?.trips.total ?? 0), delta: year?.yoy.trips },
    ]

    // Which stretch the four figures cover, said out loud. Every other band
    // that shows a part-year says so on itself, and the year select sitting
    // right above these tiles drives only the month table at the foot of the
    // page — unlabelled, the top of the viewport reads as four numbers that
    // ignored it.
    const heading = year ? (year.partial ? t("year-to-date", { year: String(year.year) }) : String(year.year)) : null

    return (
        <div className="flex flex-col gap-2 px-2">
            {heading && <h2 className="text-muted-foreground text-xs font-medium">{heading}</h2>}

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {tiles.map((tile) => (
                    <MetricTile
                        key={tile.key}
                        Icon={tile.Icon}
                        label={tile.label}
                        value={tile.value}
                        // The first year has nothing behind it, and neither
                        // does a timeline with no years at all
                        hint={year ? (tile.delta === null ? t("tiles.no-comparison") : period) : undefined}
                        delta={tile.delta}
                    />
                ))}
            </div>
        </div>
    )
}
