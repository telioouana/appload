"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useContractColumns } from "@/frontend/pages/contracts/columns/contract-columns"
import { useContractsList } from "@/frontend/pages/contracts/hooks/use-contracts-list"
import {
    CONTRACT_SORTS,
    DEFAULT_DIR,
    DEFAULT_SORT,
    PAGE_SIZES,
    contractsListInput,
    isFilteredContracts,
    type ContractRow,
} from "@/frontend/pages/contracts/types"

/**
 * The list card: the state menu, the table and the footer. Every row opens
 * the contract's own page. The table and the tiles read the same stats, so
 * the counts above and the rows below can never disagree.
 */
export function ContractsDataView() {
    const t = useTranslations("App.contracts")
    const trpc = useTRPC()
    const router = useRouter()

    const { get, sort, onSort, stateTabs, activeFilters } = useContractsList()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching; it reads the tab too
    const input = contractsListInput(get)

    const { data } = useSuspenseQuery(trpc.contracts.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.contracts.stats.queryOptions({ tab: input.tab }))
    const isRefreshing = useIsFetching({ queryKey: trpc.contracts.list.pathKey() }) > 0

    const onOpen = useCallback(
        (row: ContractRow) => router.push({ pathname: "/orders/multi/[orderId]", params: { orderId: row.id } }),
        [router],
    )

    const orgType = session.organization.type

    const columns = useContractColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.contracts.columns",
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
                    options: CONTRACT_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                }}
            />

            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                <DataTable
                    table={table}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={onOpen}
                    selectable={false}
                    isFiltered={isFilteredContracts(get)}
                    empty={{
                        title: t("data.empty"),
                        description: t(`data.empty-description.${orgType}`),
                        filtered: t("data.no-results"),
                    }}
                />
            </div>

            <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
        </ListCard>
    )
}
