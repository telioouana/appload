"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import { useFormatter, useTranslations } from "@workspace/i18n"

import type { ActiveFilter, StatusTab } from "@workspace/ui/customs/list/list-toolbar"
import type { SortState } from "@workspace/ui/customs/list/data-table"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import {
    currentYear,
    DEFAULT_DIR,
    DEFAULT_SORT,
    LOADING_WINDOW_DAYS,
    parseDir,
    statusFilter,
    type FilterOptions,
    type OrderStats,
    type Section,
} from "@/frontend/pages/orders/types"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const

/**
 * What the orders data view needs from the URL: the sort state and its
 * writer, the status tabs of the open section built from the stats, and
 * the chips for whichever filters are on. The orders sibling of
 * `usePartnerList`.
 */
export function useOrderList() {
    const t = useTranslations("Admin.orders")
    const f = useFormatter()
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

    /**
     * Every status of the section, "All" first with the section's total.
     * Strip or menu is the toolbar's call, not this hook's.
     */
    const statusTabs = (section: Section, stats: OrderStats): StatusTab[] => [
        { value: "all", label: t("list.tabs.all"), count: section === "all" ? stats.total : stats.bySection[section] },
        ...statusFilter(section).map((status) => ({
            value: status,
            label: t(`header.filters.status.options.${status}`),
            count: stats.byStatus[status],
        })),
    ]

    /** Chips for the filters that are on — everything but the status tab. */
    const activeFilters = (options?: FilterOptions): ActiveFilter[] => {
        const chips: ActiveFilter[] = []
        const push = (key: string, label: string, value: string) => chips.push({ key, label, value })

        const category = get("category")
        if (category) push("category", t("list.filters.category"), t.has(`header.filters.category.options.${category}`) ? t(`header.filters.category.options.${category}`) : category)

        const payment = get("payment")
        if (payment && t.has(`header.filters.payment.options.${payment}`)) {
            const by = get("paymentBy")
            const side = by === "shipper" || by === "carrier" ? t(`header.filters.payment.by.${by}`) : t("list.filters.either")
            push("payment", t("list.filters.payment"), `${side} · ${t(`header.filters.payment.options.${payment}`)}`)
        }

        const year = get("year")
        if (year && Number(year) !== currentYear()) push("year", t("list.filters.year"), year)

        const month = Number(get("month"))
        if (Number.isInteger(month) && month >= 1 && month <= 12) {
            push("month", t("list.filters.period"), t(`header.filters.period.month.options.${MONTHS[month - 1]}`))
        }

        const date = (value: string) => {
            const parsed = new Date(`${value}T00:00:00`)
            return Number.isNaN(parsed.getTime()) ? value : f.dateTime(parsed, { day: "numeric", month: "short" })
        }
        const from = get("from")
        if (from) push("from", t("list.filters.from"), date(from))
        const to = get("to")
        if (to) push("to", t("list.filters.to"), date(to))

        const shipper = get("shipper")
        if (shipper) push("shipper", t("list.filters.shipper"), options?.shippers.find((entry) => entry.id === shipper)?.name ?? t("list.filters.selected"))
        const carrier = get("carrier")
        if (carrier) push("carrier", t("list.filters.carrier"), options?.carriers.find((entry) => entry.id === carrier)?.name ?? t("list.filters.selected"))

        const loading = get("loading")
        if (loading) push("loading", t("list.filters.loading"), t("list.filters.loading-due", { days: Number(loading) || LOADING_WINDOW_DAYS }))
        if (get("interrupted")) push("interrupted", t("list.filters.status"), t("list.filters.interrupted"))
        if (get("flagged")) push("flagged", t("list.filters.flags"), t("list.filters.flagged"))
        if (get("pod") === "pending") push("pod", t("list.filters.flags"), t("list.filters.pod"))
        if (get("insurance") === "pending") push("insurance", t("list.filters.payment"), t("list.filters.insurance"))
        if (get("hazardous")) push("hazardous", t("list.filters.cargo"), t("list.filters.hazardous"))
        if (get("refrigerated")) push("refrigerated", t("list.filters.cargo"), t("list.filters.refrigerated"))
        if (get("route") === "regional") push("route", t("list.columns.route"), t("list.filters.regional"))

        return chips
    }

    return { get, sort, onSort, statusTabs, activeFilters }
}
