"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import type { ActiveFilter, StatusTab } from "@workspace/ui/customs/list/list-toolbar"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { FILTER_KEYS, type DriverStats } from "@/frontend/pages/drivers/types"

/**
 * The drivers list's half of the URL contract: the reader, the sort state and
 * its writer, the status tabs built from a stats bucket, and the chips for
 * whichever filters are on. Same shape as the fleet's, kept separate because
 * the two pages sort and filter on different things.
 */
export function useDriversList() {
    const t = useTranslations("App.drivers")
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const sort: SortState = { key: get("sort") ?? "name", dir: get("dir") === "desc" ? "desc" : "asc" }

    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === "name" ? null : key },
            { key: "dir", value: dir === "asc" ? null : dir },
            { key: "page", value: null },
        ]), [set])

    const statusTabs = (stats: DriverStats): StatusTab[] => [
        { value: "all", label: t("filters.all"), count: stats.total },
        { value: "draft", label: t("status.draft"), count: stats.byStatus.draft },
        { value: "pending-review", label: t("status.pending-review"), count: stats.byStatus["pending-review"] },
        { value: "verified", label: t("status.verified"), count: stats.byStatus.verified },
        { value: "issues", label: t("filters.issues"), count: stats.issues },
    ]

    const activeFilters = (): ActiveFilter[] => {
        const chips: ActiveFilter[] = []

        const state = get("state")
        if (state === "active" || state === "idle" || state === "free") {
            chips.push({ key: "state", label: t("filters.state"), value: t(`state.${state}`) })
        }

        if (get("unassigned")) {
            chips.push({ key: "unassigned", label: t("filters.assignment"), value: t("filters.unassigned") })
        }

        return chips
    }

    return { get, sort, onSort, statusTabs, activeFilters }
}

/** Whether anything narrows the list beyond its natural scope. */
export const isFilteredList = (get: (key: string) => string | null) =>
    FILTER_KEYS.some((key) => Boolean(get(key)))
