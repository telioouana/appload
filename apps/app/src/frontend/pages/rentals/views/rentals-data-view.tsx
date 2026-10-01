"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"
import { useRentalColumns } from "@/frontend/pages/rentals/columns/rental-columns"
import { useRentalsList } from "@/frontend/pages/rentals/hooks/use-rentals-list"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    PAGE_SIZES,
    RENTAL_SORTS,
    isFilteredRentals,
    rentalsListInput,
    type RentalRow,
} from "@/frontend/pages/rentals/types"

/**
 * The list card: the state menu, the table and the footer. Every row opens
 * the rental's own page. The table and the tiles read the same stats, so
 * the counts above and the rows below can never disagree.
 */
export function RentalsDataView() {
    const t = useTranslations("App.rentals")
    const trpc = useTRPC()
    const router = useRouter()
    const openNewLoad = useNewLoad((state) => state.open)

    const { get, sort, onSort, stateTabs, activeFilters } = useRentalsList()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching; it reads the tab too
    const input = rentalsListInput(get)

    const { data } = useSuspenseQuery(trpc.rentals.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.rentals.stats.queryOptions({ tab: input.tab }))
    const isRefreshing = useIsFetching({ queryKey: trpc.rentals.list.pathKey() }) > 0

    const onOpen = useCallback(
        (row: RentalRow) => router.push({ pathname: "/orders/rental/[orderId]", params: { orderId: row.id } }),
        [router],
    )

    const orgType = session.organization.type

    const columns = useRentalColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.rentals.columns",
    })

    const chips = activeFilters()

    return (
        <ListCard>
            <ListToolbar
                table={table}
                tabs={{ param: "status", items: stateTabs(stats), as: "menu" }}
                filterCount={chips.length}
                activeFilters={chips}
                sort={{
                    defaultValue: DEFAULT_SORT,
                    defaultDir: DEFAULT_DIR,
                    options: RENTAL_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                }}
            />

            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                <DataTable
                    table={table}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={onOpen}
                    selectable={false}
                    isFiltered={isFilteredRentals(get)}
                    empty={{
                        title: t("data.empty"),
                        description: t(`data.empty-description.${orgType}`),
                        filtered: t("data.no-results"),
                        action: <Button onClick={() => openNewLoad("partner", { kind: "rental" })}>{t("add.trigger")}</Button>,
                    }}
                />
            </div>

            <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
        </ListCard>
    )
}
