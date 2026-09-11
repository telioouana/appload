"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useOrderColumns } from "@/frontend/pages/orders/columns/order-columns"
import { isFilteredList, useOrdersList } from "@/frontend/pages/orders/hooks/use-orders-list"
import { useNewOrder } from "@/frontend/pages/orders/hooks/use-new-order"
import {
    ORDER_SORTS,
    PAGE_SIZES,
    ordersListInput,
    type OrderRow,
    type OrderSection,
} from "@/frontend/pages/orders/types"

export function OrdersDataView({ section }: { section: OrderSection }) {
    const t = useTranslations("App.orders")
    const trpc = useTRPC()
    const router = useRouter()

    const { get, sort, onSort, activeFilters } = useOrdersList()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const orgType = session.organization.type

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching
    const input = ordersListInput(section, get)

    const { data } = useSuspenseQuery(trpc.orders.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.orders.stats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.orders.list.pathKey() }) > 0

    const { open: openNewOrder } = useNewOrder()

    const onOpen = useCallback(
        (row: OrderRow) => router.push({ pathname: "/appload/details/[orderId]", params: { orderId: row.orderId } }),
        [router],
    )

    const columns = useOrderColumns({ orgType })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.orderId,
        storageKey: "appload.portal.orders.columns",
    })

    const chips = activeFilters()

    return (
        <ListCard>
            <ListToolbar
                table={table}
                // The sections are routes, not a URL filter, so their tabs are
                // links in the page header; the toolbar keeps the controls
                // that do write the query string
                tabs={{ param: "section", items: [] }}
                filterCount={chips.length}
                activeFilters={chips}
                sort={{
                    defaultValue: "newest",
                    defaultDir: "desc",
                    options: ORDER_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                }}
                filters={orgType === "carrier" ? (
                    <div className="flex flex-col gap-1">
                        <FilterToggle
                            label={t("filters.dispatch")}
                            hint={t("filters.dispatch-hint")}
                            param="dispatch"
                            value="1"
                            count={stats.attention.toDispatch}
                        />
                    </div>
                ) : undefined}
            />

            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                <DataTable
                    table={table}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={onOpen}
                    selectable={false}
                    isFiltered={isFilteredList(get)}
                    empty={{
                        title: t(`data.empty.${section}`),
                        description: t(`data.empty-description.${orgType}`),
                        filtered: t("data.no-results"),
                        action: orgType === "shipper"
                            ? <Button onClick={openNewOrder}>{t("actions.new-order")}</Button>
                            : undefined,
                    }}
                />
            </div>

            <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
        </ListCard>
    )
}
