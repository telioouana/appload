"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import type { ActiveFilter, StatusTab } from "@workspace/ui/customs/list/list-toolbar"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { EXPIRY_WINDOW_DAYS, type StatsBucket } from "@/frontend/pages/partners/types"

/**
 * What the three partner data views have in common: reading the URL, the
 * sort state and its writer, the status tabs built from a stats bucket and
 * the chips for whichever filters are on.
 *
 * `defaultSort` is the column the server falls back to, so an absent `sort`
 * param still marks that header as the active one — and writing it back
 * clears the param instead of spelling out the default.
 */
export function usePartnerList(defaultSort: string) {
    const t = useTranslations("Admin.partners")
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const sort: SortState = { key: get("sort") ?? defaultSort, dir: get("dir") === "desc" ? "desc" : "asc" }

    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === defaultSort ? null : key },
            { key: "dir", value: dir === "asc" ? null : dir },
            { key: "page", value: null },
        ]), [set, defaultSort])

    const statusTabs = (stats: StatsBucket): StatusTab[] => [
        { value: "all", label: t("filters.all"), count: stats.total },
        { value: "draft", label: t("status.draft"), count: stats.byStatus.draft },
        { value: "pending-review", label: t("status.pending-review"), count: stats.byStatus["pending-review"] },
        { value: "verified", label: t("status.verified"), count: stats.byStatus.verified },
        { value: "issues", label: t("filters.issues"), count: stats.issues },
    ]

    /** Chips for the filters that are on — everything but the status tab. */
    const activeFilters = (): ActiveFilter[] => {
        const chips: ActiveFilter[] = []
        const push = (key: string, label: string, value: string) => chips.push({ key, label, value })

        const expiring = get("expiring")
        if (expiring) push("expiring", t("filters.expiring"), t("filters.within-days", { days: Number(expiring) || EXPIRY_WINDOW_DAYS }))
        if (get("incomplete")) push("incomplete", t("filters.profile"), t("filters.incomplete"))
        if (get("claims")) push("claims", t("portal.title"), t("filters.claims"))

        const contract = get("contract")
        if (contract === "valid" || contract === "missing") push("contract", t("columns.contract"), t(`filters.contract-options.${contract}`))

        const risk = get("risk")
        if (risk === "flagged" || risk === "watch" || risk === "high") push("risk", t("columns.risk"), t(`filters.risk-options.${risk}`))

        const province = get("province")
        if (province) push("province", t("filters.province"), province)

        const ownership = get("ownership")
        if (ownership === "unverified" || ownership === "owner-verified" || ownership === "third-party") {
            push("ownership", t("columns.ownership"), t(`ownership.${ownership}`))
        }

        if (get("phone") === "missing") push("phone", t("columns.phone"), t("values.missing"))
        if (get("unassigned")) push("unassigned", t("filters.assignment"), t("values.unassigned"))
        if (get("carrier")) push("carrier", t("columns.carrier"), t("filters.selected"))

        return chips
    }

    return { get, sort, onSort, statusTabs, activeFilters }
}

/** The list input minus its paging, for an export that wants every matching row. */
export function withoutPaging<T extends { page: number; pageSize: number }>(input: T): Omit<T, "page" | "pageSize"> {
    const { page, pageSize, ...scope } = input
    void page
    void pageSize
    return scope
}

/** Whether anything narrows the list beyond its natural scope. */
export const isFilteredList = (get: (key: string) => string | null) =>
    ["search", "status", "expiring", "incomplete", "contract", "risk", "province", "ownership", "phone", "unassigned", "carrier", "claims"]
        .some((key) => Boolean(get(key)))
