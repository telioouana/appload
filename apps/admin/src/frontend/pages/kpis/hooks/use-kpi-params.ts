"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { DEFAULT_PRESET, kpiPeriod, kpiType, maputoToday, type PeriodPreset } from "@/frontend/pages/kpis/types"

/**
 * The period both KPI pages are read over, and the controls that write it.
 * Every control writes through here rather than touching the query string
 * itself, because the writes have rules a control would have to repeat — and
 * a control that got one wrong would leave the page showing a period nobody
 * asked for.
 *
 * The rule that matters is that **defaults are absent, not spelled out**: the
 * current Maputo year, month and quarter clear their param instead of pinning
 * today's number into a link, so a bookmark taken in September still means
 * "this month" in October. The side of the trade is read here but written by
 * the list's tabs, and the party is a route segment rather than a param at all.
 */
export function useKpiParams() {
    const searchParams = useSearchParams()
    const { set, isPending } = useListParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const period = kpiPeriod(get)

    const today = maputoToday()
    const thisYear = Number(today.slice(0, 4))
    const thisMonth = Number(today.slice(5, 7))

    /** A control's value, or nothing at all when it names the current one. */
    const unlessNow = (value: number, now: number) => (value === now ? null : String(value))

    /**
     * Every period write drops the page with it: a narrower period has fewer
     * partners, and page four of the old one is an empty list in the new.
     */
    const RESET_PAGE = { key: "page", value: null }

    const setPreset = (preset: PeriodPreset) => {
        // A custom range starts from what is already on screen: the calendar
        // opens on the period the page was showing rather than on nothing
        if (preset === "custom") {
            set([
                { key: "period", value: "custom" },
                { key: "from", value: period.from },
                { key: "to", value: period.to },
                { key: "year", value: null },
                { key: "month", value: null },
                { key: "quarter", value: null },
                RESET_PAGE,
            ])
            return
        }

        // The other three read their own controls, and every one of them
        // defaults to now — so clearing the lot is what "this month" means
        set([
            { key: "period", value: preset === DEFAULT_PRESET ? null : preset },
            { key: "year", value: null },
            { key: "month", value: null },
            { key: "quarter", value: null },
            { key: "from", value: null },
            { key: "to", value: null },
            RESET_PAGE,
        ])
    }

    return {
        type: kpiType(get),
        period,
        isPending,

        setPreset,

        setYear: (year: number) => set([{ key: "year", value: unlessNow(year, thisYear) }, RESET_PAGE]),
        setMonth: (month: number) => set([{ key: "month", value: unlessNow(month, thisMonth) }, RESET_PAGE]),
        setQuarter: (quarter: number) =>
            set([{ key: "quarter", value: unlessNow(quarter, Math.ceil(thisMonth / 3)) }, RESET_PAGE]),

        setRange: (from: string, to: string) =>
            set([
                { key: "from", value: from },
                { key: "to", value: to },
                RESET_PAGE,
            ]),
    }
}
