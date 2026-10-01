"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import type { ActiveFilter, StatusTab } from "@workspace/ui/customs/list/list-toolbar"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { DEFAULT_DIR, DEFAULT_SORT, RENTAL_STATES, type RentalStats } from "@/frontend/pages/rentals/types"

/** What the rentals list needs from the URL: the reader, the sort state and its writer, the state tabs. */
export function useRentalsList() {
    const t = useTranslations("App.rentals")
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

    const stateTabs = (stats: RentalStats): StatusTab[] => [
        { value: "all", label: t("filters.all"), count: stats.total },
        ...RENTAL_STATES.map((state) => ({ value: state, label: t(`states.${state}`), count: stats.byState[state] })),
    ]

    const activeFilters = (): ActiveFilter[] => []

    return { get, sort, onSort, stateTabs, activeFilters }
}
