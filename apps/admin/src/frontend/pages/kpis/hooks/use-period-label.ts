"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { utcDay, type KpiPeriod } from "@/frontend/pages/kpis/types"

/**
 * The period as a person says it: "2026", "September 2026", "Q3 2026", or the
 * two ends of a range. Written once and read by the page description, the
 * landing heading and the custom-range trigger, so the header cannot name the
 * stretch one way and a card another.
 *
 * The year goes in as a string on purpose: an ICU argument holding a number
 * would be formatted as one, and "Q3 2,026" is nobody's idea of a quarter.
 */
export function usePeriodLabel(period: KpiPeriod): string {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()

    if (period.preset === "month") {
        // Mid-month, so no offset can nudge the name into a neighbour
        return f.dateTime(new Date(Date.UTC(period.year, period.month - 1, 15)), { month: "long", year: "numeric" })
    }

    if (period.preset === "quarter") {
        return t("period.quarter-label", { quarter: period.quarter, year: String(period.year) })
    }

    if (period.preset === "custom") {
        const medium = (day: string) => f.dateTime(utcDay(day), { dateStyle: "medium" })
        return t("period.range", { from: medium(period.from), to: medium(period.to) })
    }

    return String(period.year)
}
