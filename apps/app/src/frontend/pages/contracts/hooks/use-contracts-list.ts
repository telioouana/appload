"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import type { ActiveFilter, StatusTab } from "@workspace/ui/customs/list/list-toolbar"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import {
    CONTRACT_STATES,
    DEFAULT_DIR,
    DEFAULT_SORT,
    type ContractStats,
} from "@/frontend/pages/contracts/types"

/**
 * What the contracts list needs from the URL: the reader, the sort state and
 * its writer, and the state tabs built from the stats bucket.
 *
 * The default sort is the column the server falls back to, so an absent
 * `sort` param still marks that header as active — and writing it back clears
 * the param instead of spelling out the default.
 */
export function useContractsList() {
    const t = useTranslations("App.contracts")
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

    const stateTabs = (stats: ContractStats): StatusTab[] => [
        { value: "all", label: t("filters.all"), count: stats.total },
        ...CONTRACT_STATES.map((state) => ({
            value: state,
            label: t(`states.${state}`),
            count: stats.byState[state],
        })),
    ]

    /** Chips for the filters that are on — nothing narrows the list but the state tab yet. */
    const activeFilters = (): ActiveFilter[] => []

    return { get, sort, onSort, stateTabs, activeFilters }
}
