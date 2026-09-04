"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"
import { DISPUTE_STATUS } from "@workspace/db/types"

import type { ActiveFilter, StatusTab } from "@/components/list/list-toolbar"
import type { SortState } from "@/components/list/data-table"
import { useListParams } from "@/components/list/use-list-params"
import { DEFAULT_DIR, DEFAULT_SORT, parseDir, type DisputeStats } from "@/frontend/pages/disputes/types"

/** The disputes list's URL state: sort, the status tabs and the filter chips. */
export function useDisputeList() {
    const t = useTranslations("Admin.disputes")
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const sort: SortState = { key: get("sort") ?? DEFAULT_SORT, dir: parseDir(get("dir")) }

    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === DEFAULT_SORT ? null : key },
            { key: "dir", value: dir === DEFAULT_DIR ? null : dir },
            { key: "page", value: null },
        ]), [set])

    const statusTabs = (stats: DisputeStats): StatusTab[] => [
        { value: "all", label: t("tabs.all"), count: stats.total },
        ...DISPUTE_STATUS.map((status) => ({ value: status, label: t(`values.statuses.${status}`), count: stats.byStatus[status] })),
    ]

    const activeFilters = (): ActiveFilter[] => {
        const chips: ActiveFilter[] = []

        const reason = get("reason")
        if (reason && t.has(`values.reasons.${reason}`)) chips.push({ key: "reason", label: t("filters.reason"), value: t(`values.reasons.${reason}`) })

        const liable = get("liable")
        if (liable && t.has(`values.liable.${liable}`)) chips.push({ key: "liable", label: t("filters.liable"), value: t(`values.liable.${liable}`) })

        const hold = get("hold")
        if (hold === "shipper" || hold === "carrier") chips.push({ key: "hold", label: t("filters.hold"), value: t(`values.hold-${hold}`) })

        return chips
    }

    return { get, sort, onSort, statusTabs, activeFilters }
}
