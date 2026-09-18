"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { RangePopover } from "@/frontend/pages/kpis/components/range-popover"
import { useKpiParams } from "@/frontend/pages/kpis/hooks/use-kpi-params"
import { PERIOD_PRESETS, type PeriodPreset } from "@/frontend/pages/kpis/types"
import { currentYear, FIRST_YEAR } from "@/frontend/pages/orders/types"

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const QUARTERS = [1, 2, 3, 4]

/** The month of the chosen year, named in the reader's language. */
function MonthSelect({ month }: { month: number }) {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const { setMonth } = useKpiParams()

    return (
        <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
            <SelectTrigger size="sm" aria-label={t("period.month-select")}>
                <SelectValue />
            </SelectTrigger>

            <SelectContent position="popper" className="max-h-72">
                {MONTHS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                        {/* Mid-month at UTC: Maputo is UTC+2, so the name can
                            never slip into a neighbouring month */}
                        {f.dateTime(new Date(Date.UTC(2000, option - 1, 15)), { month: "long" })}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/** The quarter of the chosen year, in whatever shorthand the language uses. */
function QuarterSelect({ quarter }: { quarter: number }) {
    const t = useTranslations("Admin.kpis")
    const { setQuarter } = useKpiParams()

    return (
        <Select value={String(quarter)} onValueChange={(value) => setQuarter(Number(value))}>
            <SelectTrigger size="sm" aria-label={t("period.quarter-select")}>
                <SelectValue />
            </SelectTrigger>

            <SelectContent position="popper">
                {QUARTERS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                        {t("period.quarter-name", { quarter: option })}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/**
 * The year the other two selects hang off, and the whole period under the
 * `year` preset. Same options as the dashboard's, but the write goes through
 * `useKpiParams` like every other control here — the list is paged, and a year
 * that changed the period without dropping the page would leave the reader on
 * page four of a shorter ranking.
 */
function YearSelect({ year }: { year: number }) {
    const t = useTranslations("Admin.kpis")
    const { setYear } = useKpiParams()

    // Newest first, and a year arriving from outside the range still names
    // itself rather than leaving the trigger blank
    const now = currentYear()
    const years = Array.from({ length: now - FIRST_YEAR + 1 }, (_, index) => now - index)
    const options = years.includes(year) ? years : [year, ...years]

    return (
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger size="sm" aria-label={t("period.year-select")}>
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

/**
 * The stretch every figure on the page is counted over: a preset, then
 * whatever that preset needs to be pinned down. Month and quarter carry the
 * year with them — a quarter with no year is a season, not a period — while a
 * custom range replaces the selects with the calendar, since its two ends
 * already say which years they belong to.
 */
export function PeriodControl() {
    const t = useTranslations("Admin.kpis")
    const { period, setPreset } = useKpiParams()

    return (
        <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                spacing={0}
                aria-label={t("period.label")}
                value={period.preset}
                onValueChange={(value) => {
                    // Radix hands back "" when the pressed item is pressed
                    // again; the page is always over some period, so that is
                    // ignored
                    if (!(PERIOD_PRESETS as readonly string[]).includes(value)) return

                    setPreset(value as PeriodPreset)
                }}
            >
                {PERIOD_PRESETS.map((preset) => (
                    <ToggleGroupItem key={preset} value={preset} className="text-xs">
                        {t(`period.${preset}`)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>

            {period.preset === "month" && <MonthSelect month={period.month} />}
            {period.preset === "quarter" && <QuarterSelect quarter={period.quarter} />}
            {period.preset === "custom" ? <RangePopover /> : <YearSelect year={period.year} />}
        </div>
    )
}
