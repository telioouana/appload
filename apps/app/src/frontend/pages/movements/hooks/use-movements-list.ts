"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useFormatter, useTranslations } from "@workspace/i18n"

import type { ActiveFilter } from "@workspace/ui/customs/list/list-toolbar"
import type { SortState } from "@workspace/ui/customs/list/data-table"
import { useListParams } from "@workspace/ui/hooks/use-list-params"

import { MONTHS } from "@/frontend/pages/movements/sections/movement-filters"
import { DEFAULT_DIR, DEFAULT_SORT, type LoadFormOptions } from "@/frontend/pages/movements/types"

/**
 * What the two load tables need from the URL: the reader, and the sort
 * state and its writer. The section is not here — it is the route segment —
 * so switching section navigates instead of writing the query string.
 *
 * The default sort is the column the server falls back to, so an absent
 * `sort` param still marks that header as active, and writing it back clears
 * the param instead of spelling out the default.
 */
export function useMovementsList() {
    const t = useTranslations("App.loads.filters")
    const f = useFormatter()
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const sort: SortState = {
        key: get("sort") ?? DEFAULT_SORT,
        dir: get("dir") === "asc" ? "asc" : DEFAULT_DIR,
    }

    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === DEFAULT_SORT ? null : key },
            { key: "dir", value: dir === DEFAULT_DIR ? null : dir },
            { key: "page", value: null },
        ]), [set])

    /** Chips for the filters that are on — everything but the status tab. */
    const activeFilters = (options?: Pick<LoadFormOptions, "partners">): ActiveFilter[] => {
        const chips: ActiveFilter[] = []
        const push = (key: string, label: string, value: string) => chips.push({ key, label, value })

        const partner = get("partner")
        if (partner) push("partner", t("partner"), options?.partners.find((entry) => entry.id === partner)?.name ?? t("selected"))

        const month = Number(get("month"))
        if (Number.isInteger(month) && month >= 1 && month <= 12) {
            push("month", t("period"), t(`month.${MONTHS[month - 1]}`))
        }

        const date = (value: string) => {
            const parsed = new Date(`${value}T00:00:00`)
            return Number.isNaN(parsed.getTime()) ? value : f.dateTime(parsed, { day: "numeric", month: "short" })
        }
        const from = get("from")
        if (from) push("from", t("from"), date(from))
        const to = get("to")
        if (to) push("to", t("to"), date(to))

        if (get("silent") === "1") push("silent", t("tracking"), t("silent"))
        if (get("offRoute") === "1") push("offRoute", t("tracking"), t("off-route"))
        if (get("disputed") === "1") push("disputed", t("disputes"), t("disputed"))
        if (get("hasCosts") === "1") push("hasCosts", t("costs"), t("has-costs"))

        return chips
    }

    return { get, sort, onSort, activeFilters }
}
