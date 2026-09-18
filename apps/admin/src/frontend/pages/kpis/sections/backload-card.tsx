"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { reportInput } from "@/frontend/pages/kpis/types"
import { FUEL_LITRES_PER_KM, FUEL_PRICE_MZN_PER_LITRE } from "@workspace/domain/kpis/constants"

/**
 * What backloading was worth over the period: how much of the work rode on a
 * return leg, the CO₂ the sheet credits that with, and then the figure each
 * side of the trade cares about — what the shipper saved, or the margin the
 * carrier kept over the fuel those trips burned.
 *
 * The fuel note only appears under the carrier's margin, because that is the
 * only figure resting on an assumption rather than on invoiced money: it names
 * the two constants the KPI sheet estimates fuel with, and says the estimate
 * is converted at the trip's own loading-day rate like every other amount here.
 */
export function BackloadCard() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const kpis = data.kpis
    const none = t("table.none")

    const percent = (value: number | null) =>
        value === null ? none : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    const whole = (value: number | null) => (value === null ? none : f.number(value, { maximumFractionDigits: 0 }))

    const savings = kpis.backload.kind === "savings"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("backload.title")}</h2>

            <dl className="flex flex-col gap-4">
                <div>
                    <dt className="text-muted-foreground text-xs">{t("backload.share")}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{percent(kpis.backloadShare)}</dd>
                </div>

                <div>
                    <dt className="text-muted-foreground text-xs">{t("backload.co2")}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                        {whole(kpis.co2)}
                        <span className="text-muted-foreground ml-1.5 text-xs font-normal">{t("backload.co2-unit")}</span>
                    </dd>
                </div>

                <div>
                    <dt className="text-muted-foreground text-xs">{savings ? t("backload.savings") : t("backload.margin")}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                        {kpis.backload.kind === "savings" ? whole(kpis.backload.value) : percent(kpis.backload.value)}
                    </dd>

                    {!savings && (
                        <p className="text-muted-foreground mt-1 text-xs">
                            {t("backload.fuel-note", { litres: FUEL_LITRES_PER_KM, price: FUEL_PRICE_MZN_PER_LITRE })}
                        </p>
                    )}
                </div>
            </dl>
        </section>
    )
}
