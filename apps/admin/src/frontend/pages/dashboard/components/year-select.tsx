"use client"

import { useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

import { useListParams } from "@/components/list/use-list-params"
import { currentYear, FIRST_YEAR } from "@/frontend/pages/orders/types"

/**
 * The year the chart and the money card read, written to the URL exactly as
 * the orders pages write theirs. The current year is the default, so picking
 * it clears the param instead of pinning today's number into the link — a
 * bookmark taken this year still means "this year" next January.
 *
 * The tiles, the queue and the map ignore it on purpose: they are always now.
 */
export function YearSelect({ year }: { year: number }) {
    const t = useTranslations("Admin.dashboard")
    const { set } = useListParams()

    const now = currentYear()

    // Newest first, and a year arriving from outside the range still names
    // itself rather than leaving the trigger blank
    const years = Array.from({ length: now - FIRST_YEAR + 1 }, (_, index) => now - index)
    const options = years.includes(year) ? years : [year, ...years]

    return (
        <Select
            value={String(year)}
            onValueChange={(value) => set([{ key: "year", value: Number(value) === now ? null : value }])}
        >
            <SelectTrigger size="sm" aria-label={t("year")}>
                <SelectValue />
            </SelectTrigger>

            <SelectContent position="popper" className="max-h-72">
                {options.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                        {option}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
