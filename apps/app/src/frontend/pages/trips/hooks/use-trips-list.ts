"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@/components/list/data-table"
import type { ActiveFilter, StatusTab } from "@/components/list/list-toolbar"
import { useListParams } from "@/components/list/use-list-params"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    TRIP_SECTIONS,
    type TripStats,
} from "@/frontend/pages/trips/types"

/**
 * What the trips list needs from the URL: the reader, the sort state and its
 * writer, the section tabs built from the stats bucket, and the chips for
 * whichever filters are on.
 *
 * The default sort is the column the server falls back to, so an absent
 * `sort` param still marks that header as active — and writing it back
 * clears the param instead of spelling out the default.
 */
export function useTripsList() {
    const t = useTranslations("App.trips")
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

    const sectionTabs = (stats: TripStats): StatusTab[] =>
        TRIP_SECTIONS.map((section) => ({
            value: section,
            label: t(`sections.${section}`),
            count: stats.bySection[section],
        }))

    /** Chips for the filters that are on — everything but the section tab. */
    const activeFilters = (): ActiveFilter[] =>
        get("noResponse")
            ? [{ key: "noResponse", label: t("filters.tracking"), value: t("filters.no-response") }]
            : []

    return { get, sort, onSort, sectionTabs, activeFilters }
}
