"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"

import type { SortState } from "@workspace/ui/customs/list/data-table"
import { useListParams } from "@workspace/ui/hooks/use-list-params"

import { DEFAULT_DIR, DEFAULT_SORT } from "@/frontend/pages/movements/types"

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

    return { get, sort, onSort }
}
