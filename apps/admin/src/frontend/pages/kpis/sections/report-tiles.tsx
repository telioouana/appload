"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCash, IconClockCheck, IconReceipt, IconTruck } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { MetricTile } from "@/frontend/pages/metrics/components/metric-tile"
import { reportInput } from "@/frontend/pages/kpis/types"

/** The order the conversion note names currencies in, as the cashflow strip does. */
const CURRENCIES = ["MZN", "ZAR", "USD"] as const

/**
 * The four figures the report opens on: how much work the party moved, what
 * it was worth, what one transport of it cost, and whether it arrived when it
 * said it would. Everything else on the page is these four taken apart.
 *
 * Under them runs the line that keeps the money honest. A party invoices in
 * several currencies, so every amount here was converted at its own trip's
 * loading-day rate; the note says which currencies went into the total, how
 * many trips had to borrow an earlier day's rate, and how many could not be
 * converted at all rather than letting any of that hide inside one number.
 */
export function ReportTiles() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    // The route names the party and the query string the period — the same
    // builder, and so the same query key, the page prefetched with
    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const kpis = report.kpis

    const money = (value: number, digits: number) =>
        f.number(value, { minimumFractionDigits: digits === 2 ? 2 : 0, maximumFractionDigits: digits })
    const percent = (value: number | null) =>
        value === null ? "—" : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    // The note is a chain of clauses, each one only worth a place when it has
    // something to say: no currencies at all in an empty period, and no
    // borrowed or missing rates on a period the seed has covered
    const segments = [t("conversion.note")]

    const currencies = CURRENCIES.filter((code) => kpis.byCurrency[code] > 0).map((code) =>
        t("conversion.by-currency", { count: kpis.byCurrency[code], currency: code }),
    )
    if (currencies.length > 0) segments.push(currencies.join(", "))

    if (kpis.provisionalTransports > 0) {
        segments.push(t("conversion.provisional", { count: kpis.provisionalTransports }))
    }
    if (kpis.unratedTransports > 0) {
        segments.push(t("conversion.unrated", { count: kpis.unratedTransports }))
    }

    return (
        <>
            <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
                <MetricTile
                    Icon={IconTruck}
                    label={t("tiles.transports")}
                    value={f.number(kpis.transports)}
                    hint={t("tiles.transports-hint", {
                        deliveries: kpis.deliveries,
                        tons: money(kpis.tons, 1),
                    })}
                />

                <MetricTile
                    Icon={IconCash}
                    label={t("tiles.total")}
                    value={money(kpis.total, 0)}
                    hint={t("tiles.total-hint", { km: money(kpis.km, 0) })}
                />

                <MetricTile
                    Icon={IconReceipt}
                    label={t("tiles.price-per-transport")}
                    value={kpis.pricePerTransport === null ? "—" : money(kpis.pricePerTransport, 0)}
                    hint={t("tiles.price-hint", {
                        costPerKm: kpis.costPerKm === null ? "—" : money(kpis.costPerKm, 2),
                    })}
                />

                <MetricTile
                    Icon={IconClockCheck}
                    label={t("tiles.on-time")}
                    value={percent(kpis.onTimeOffloadingRate)}
                    hint={t("tiles.on-time-hint", { loading: percent(kpis.onTimeLoadingRate) })}
                />
            </div>

            {/* The band around the tiles has no gap of its own, so the note
                keeps its own air from them */}
            <p className="text-muted-foreground px-2 pt-2 text-xs">{segments.join(" · ")}</p>
        </>
    )
}
