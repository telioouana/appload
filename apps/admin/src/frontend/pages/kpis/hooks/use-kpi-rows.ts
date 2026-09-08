"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import type { KpiReport } from "@/frontend/pages/kpis/types"

/** One line of the full report: what it measures, in what unit, and the figure. */
export type KpiRow = {
    key: string
    label: string
    /** Empty for the rows that have no unit to name */
    unit: string
    value: string
    /** A row with nothing behind it yet — printed quietly rather than as a zero */
    muted?: boolean
}

export type KpiRowGroup = { key: string; title: string; rows: KpiRow[] }

/**
 * The full report as the PDF prints it: six groups in the templates' own
 * order, every figure already formatted, so the table only has to lay them
 * out. The digit rules are the PDF's too — counts, money, distance and CO₂
 * whole, tonnage and durations to a tenth, costs to a cent, rates as whole
 * percents — because the same numbers are read on screen and in the file, and
 * two roundings would eventually disagree in a meeting.
 *
 * Money is USD throughout, converted per trip at its loading-day rate before
 * it reached the report. A figure with an empty divisor arrives as `null` and
 * prints as a dash, never as a zero.
 *
 * The four average durations are averaged over the trips that recorded one,
 * so when that sample is smaller than the transports analysed the unit cell
 * says by how much ("days · 12 of 72") — an average over one trip in seventy
 * is not a period average, and the reader deserves to see that before quoting
 * it. The three Communication rows are the sheet's ratings, which live outside
 * the app: they hold their place, greyed, until they are collected here.
 */
export function useKpiRows(report: KpiReport): KpiRowGroup[] {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()

    const kpis = report.kpis
    const none = t("table.none")

    const whole = (value: number | null) => (value === null ? none : f.number(value, { maximumFractionDigits: 0 }))
    const tenth = (value: number | null) => (value === null ? none : f.number(value, { maximumFractionDigits: 1 }))
    const cent = (value: number | null) => (value === null ? none : f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    // The unit column already carries the %, so the cell holds the number
    const percent = (value: number | null) => (value === null ? none : f.number(value * 100, { maximumFractionDigits: 0 }))

    const unit = {
        number: t("table.units.number"),
        tons: t("table.units.t"),
        km: t("table.units.km"),
        days: t("table.units.days"),
        kmPerDay: t("table.units.km-per-day"),
        percent: t("table.units.percent"),
        usd: t("table.units.usd"),
        perKm: t("table.units.per-km"),
        perTon: t("table.units.per-ton"),
        perTonKm: t("table.units.per-ton-km"),
        co2: t("table.units.co2"),
    }

    const sample = (trips: number) =>
        trips < kpis.transports
            ? t("table.sample", { unit: unit.days, count: whole(trips), total: whole(kpis.transports) })
            : unit.days

    const backload: KpiRow =
        kpis.backload.kind === "savings"
            ? { key: "savings", label: t("table.rows.savings"), unit: unit.usd, value: whole(kpis.backload.value) }
            : {
                  key: "fuel-margin",
                  label: t("table.rows.fuel-margin"),
                  unit: unit.percent,
                  value: percent(kpis.backload.value),
              }

    return [
        {
            key: "summary",
            title: t("table.groups.summary"),
            rows: [
                { key: "transports", label: t("table.rows.transports"), unit: unit.number, value: whole(kpis.transports) },
                { key: "total", label: t("table.rows.total"), unit: unit.usd, value: whole(kpis.total) },
                {
                    key: "price-per-transport",
                    label: t("table.rows.price-per-transport"),
                    unit: unit.usd,
                    value: whole(kpis.pricePerTransport),
                },
                { key: "deliveries", label: t("table.rows.deliveries"), unit: unit.number, value: whole(kpis.deliveries) },
                { key: "tons", label: t("table.rows.tons"), unit: unit.tons, value: tenth(kpis.tons) },
                { key: "km", label: t("table.rows.km"), unit: unit.km, value: whole(kpis.km) },
                {
                    key: "tons-per-transport",
                    label: t("table.rows.tons-per-transport"),
                    unit: unit.tons,
                    value: tenth(kpis.tonsPerTransport),
                },
                {
                    key: "km-per-transport",
                    label: t("table.rows.km-per-transport"),
                    unit: unit.km,
                    value: whole(kpis.kmPerTransport),
                },
            ],
        },
        {
            key: "operational",
            title: t("table.groups.operational"),
            rows: [
                {
                    key: "on-time-loading",
                    label: t("table.rows.on-time-loading"),
                    unit: unit.percent,
                    value: percent(kpis.onTimeLoadingRate),
                },
                {
                    key: "loading-days",
                    label: t("table.rows.loading-days"),
                    unit: sample(kpis.loadingDaysTrips),
                    value: tenth(kpis.avgLoadingDays),
                },
                {
                    key: "travel-days",
                    label: t("table.rows.travel-days"),
                    unit: sample(kpis.travelDaysTrips),
                    value: tenth(kpis.avgTravelDays),
                },
                { key: "km-per-day", label: t("table.rows.km-per-day"), unit: unit.kmPerDay, value: tenth(kpis.kmPerDay) },
                {
                    key: "on-time-offloading",
                    label: t("table.rows.on-time-offloading"),
                    unit: unit.percent,
                    value: percent(kpis.onTimeOffloadingRate),
                },
                {
                    key: "offloading-days",
                    label: t("table.rows.offloading-days"),
                    unit: sample(kpis.offloadingDaysTrips),
                    value: tenth(kpis.avgOffloadingDays),
                },
                {
                    key: "border-days",
                    label: t("table.rows.border-days"),
                    unit: sample(kpis.borderDaysTrips),
                    value: tenth(kpis.avgBorderDays),
                },
                {
                    key: "demurrage-rate",
                    label: t("table.rows.demurrage-rate"),
                    unit: unit.percent,
                    value: percent(kpis.demurrageRate),
                },
                {
                    key: "demurrage-days",
                    label: t("table.rows.demurrage-days"),
                    unit: unit.days,
                    value: tenth(kpis.demurrageDays),
                },
            ],
        },
        {
            key: "incidents",
            title: t("table.groups.incidents"),
            rows: [
                { key: "accidents", label: t("table.rows.accidents"), unit: unit.number, value: whole(kpis.accidents) },
                { key: "mechanical", label: t("table.rows.mechanical"), unit: unit.number, value: whole(kpis.mechanical) },
                {
                    key: "documentation",
                    label: t("table.rows.documentation"),
                    unit: unit.number,
                    value: whole(kpis.documentation),
                },
                { key: "police", label: t("table.rows.police"), unit: unit.number, value: whole(kpis.police) },
                { key: "delay-days", label: t("table.rows.delay-days"), unit: unit.days, value: tenth(kpis.delayDays) },
                {
                    key: "damage-rate",
                    label: t("table.rows.damage-rate"),
                    unit: unit.percent,
                    value: percent(kpis.damageRate),
                },
                { key: "claim-rate", label: t("table.rows.claim-rate"), unit: unit.percent, value: percent(kpis.claimRate) },
            ],
        },
        {
            key: "cost",
            title: t("table.groups.cost"),
            rows: [
                { key: "cost-per-km", label: t("table.rows.cost-per-km"), unit: unit.perKm, value: cent(kpis.costPerKm) },
                { key: "cost-per-ton", label: t("table.rows.cost-per-ton"), unit: unit.perTon, value: cent(kpis.costPerTon) },
                {
                    key: "cost-per-ton-km",
                    label: t("table.rows.cost-per-ton-km"),
                    unit: unit.perTonKm,
                    value: cent(kpis.costPerTonKm),
                },
            ],
        },
        {
            key: "backload",
            title: t("table.groups.backload"),
            rows: [
                {
                    key: "backload-share",
                    label: t("table.rows.backload-share"),
                    unit: unit.percent,
                    value: percent(kpis.backloadShare),
                },
                { key: "co2", label: t("table.rows.co2"), unit: unit.co2, value: whole(kpis.co2) },
                backload,
            ],
        },
        {
            key: "communication",
            title: t("table.groups.communication"),
            rows: [
                { key: "communication", label: t("table.rows.communication"), unit: "", value: t("table.not-tracked"), muted: true },
                {
                    key: "responsiveness",
                    label: t("table.rows.responsiveness"),
                    unit: "",
                    value: t("table.not-tracked"),
                    muted: true,
                },
                {
                    key: "satisfaction",
                    label: t("table.rows.satisfaction"),
                    unit: "",
                    value: t("table.not-tracked"),
                    muted: true,
                },
            ],
        },
    ]
}
