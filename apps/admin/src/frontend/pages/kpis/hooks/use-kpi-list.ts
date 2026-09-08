"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import type { SortState } from "@/components/list/data-table"
import { useListParams } from "@/components/list/use-list-params"
import { useRouter } from "@/i18n/navigation"
import { carriedQuery } from "@/frontend/pages/kpis/types"

/** The column the server ranks by when `sort` is absent, and the direction it ranks in. */
const DEFAULT_SORT = "transports"

/**
 * What the KPI list's card needs from the URL: the reader, the sort state and
 * its writer, and the door to a party's report.
 *
 * Same shape as `usePartnerList`, with the two differences this list has. The
 * default direction is descending — it is a ranking, and a ranking opens on
 * its top — and opening a row is a **push** to a nested route rather than a
 * sheet: the browser keeps the list's own entry, so Back comes back to the
 * period, the tab and the page the reader left.
 */
export function useKpiList() {
    const searchParams = useSearchParams()
    const { set } = useListParams()
    const router = useRouter()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const sort: SortState = { key: get("sort") ?? DEFAULT_SORT, dir: get("dir") === "asc" ? "asc" : "desc" }

    // Defaults stay out of the URL, so a link only ever spells out what was
    // actually chosen — and a narrower sort never opens on a stale page
    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === DEFAULT_SORT ? null : key },
            { key: "dir", value: dir === "desc" ? null : dir },
            { key: "page", value: null },
        ]), [set])

    /** The report of one party, carrying the period across and leaving the paging behind. */
    const open = useCallback((party: string) =>
        router.push({ pathname: "/kpis/[party]", params: { party }, query: carriedQuery(get) }), [router, get])

    return { get, sort, onSort, open }
}
