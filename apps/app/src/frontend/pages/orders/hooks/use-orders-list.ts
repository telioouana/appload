"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import type { ActiveFilter } from "@workspace/ui/customs/list/list-toolbar"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { DEFAULT_DIR, DEFAULT_SORT, FILTER_KEYS } from "@/frontend/pages/orders/types"

/**
 * What the orders table needs from the URL: the reader, the sort state and
 * its writer, and the chips for whichever filters are on.
 *
 * The section is NOT here — it is the route segment, not a param — so
 * switching page navigates instead of writing the query string, and the
 * filters below survive that navigation exactly as they would a refresh.
 */
export function useOrdersList() {
    const t = useTranslations("App.orders")
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

    /** Chips for the filters that are on; the search box owns its own. */
    const activeFilters = (): ActiveFilter[] => {
        const chips: ActiveFilter[] = []

        if (get("dispatch")) {
            chips.push({ key: "dispatch", label: t("filters.dispatch"), value: t("filters.dispatch-value") })
        }

        return chips
    }

    return { get, sort, onSort, activeFilters }
}

/** Whether anything narrows the list beyond its section. */
export const isFilteredList = (get: (key: string) => string | null) =>
    FILTER_KEYS.some((key) => Boolean(get(key)))
