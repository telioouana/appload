"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { analyticsPeriod, type AnalyticsPeriod } from "@/frontend/pages/analytics/types"

/**
 * The period as a person says it: "2026", "Setembro de 2026" or "3.º
 * trimestre de 2026". Written once and read by the page description, so the
 * header cannot name the stretch one way and a card another.
 *
 * The month and the quarter are resolved by the same parser the procedures
 * count with, so the name over the page and the range under it can never
 * drift apart.
 *
 * The year goes into the message as a string on purpose: an ICU argument
 * holding a number would be formatted as one, and "3.º trimestre de 2.026"
 * is nobody's idea of a quarter.
 */
export function usePeriodLabel(period: AnalyticsPeriod, year: number): string {
    const t = useTranslations("App.analytics.period")
    const f = useFormatter()

    const resolved = analyticsPeriod(period, year)

    if (period === "month") {
        // Mid-month at UTC: Maputo is UTC+2, so the name can never slip into
        // a neighbouring month
        return f.dateTime(new Date(Date.UTC(resolved.year, resolved.month - 1, 15)), { month: "long", year: "numeric" })
    }

    if (period === "quarter") {
        return t("quarter-label", { quarter: resolved.quarter, year: String(resolved.year) })
    }

    return String(resolved.year)
}
