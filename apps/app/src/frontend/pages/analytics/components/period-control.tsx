"use client"

import { useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { ANALYTICS_PERIODS, currentYear, DEFAULT_PERIOD, type AnalyticsPeriod } from "@/frontend/pages/analytics/types"

/** The first year Appload's order book covers, so a company can look back over all of it. */
const FIRST_YEAR = 2022

/**
 * The stretch every figure on the page is counted over: the preset, and the
 * year it hangs off. Month and quarter mean the current one of that year —
 * the year is the only control they carry, which is what keeps a shared link
 * short and unambiguous.
 *
 * Both writes follow the rule the list pages write filters with: **defaults
 * are absent, not spelled out**, so picking "Ano" or this year clears its
 * param instead of pinning today's number into the link, and a bookmark
 * taken in September still means "this year" next January.
 */
export function PeriodControl({ period, year }: { period: AnalyticsPeriod; year: number }) {
    const t = useTranslations("App.analytics.period")
    const { set } = useListParams()

    const now = currentYear()

    // Newest first, and a year arriving from outside the range still names
    // itself rather than leaving the trigger blank
    const years = Array.from({ length: now - FIRST_YEAR + 1 }, (_, index) => now - index)
    const options = years.includes(year) ? years : [year, ...years]

    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label={t("label")} className="bg-muted flex w-fit gap-0.5 rounded-full p-1">
                {ANALYTICS_PERIODS.map((preset) => {
                    const selected = preset === period

                    return (
                        <button
                            key={preset}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => set([{ key: "period", value: preset === DEFAULT_PERIOD ? null : preset }])}
                            className={cn(
                                "text-muted-foreground flex h-7 cursor-pointer items-center rounded-full px-3 text-[13px] transition-colors",
                                selected && "bg-background text-foreground font-medium shadow-sm",
                            )}
                        >
                            {t(preset)}
                        </button>
                    )
                })}
            </div>

            <Select
                value={String(year)}
                onValueChange={(value) => set([{ key: "year", value: Number(value) === now ? null : value }])}
            >
                <SelectTrigger size="sm" aria-label={t("year-select")}>
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
        </div>
    )
}
