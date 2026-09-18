"use client"

import { useCallback, useState } from "react"
import { useIsFetching, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { BulkAction, BulkBar } from "@workspace/ui/customs/list/bulk-bar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"
import { useDisputeColumns } from "@/frontend/pages/disputes/columns/dispute-columns"
import { useDisputeList } from "@/frontend/pages/disputes/hooks/use-dispute-list"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import { DisputeFilters } from "@/frontend/pages/disputes/sections/dispute-filters"
import { DisputeSheet } from "@/frontend/pages/disputes/views/dispute-sheet"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    DISPUTE_SORTS,
    disputesListInput,
    isFilteredDisputes,
    PAGE_SIZES,
    withoutPaging,
    type DisputeRow,
} from "@/frontend/pages/disputes/types"

export function DisputesDataView() {
    const t = useTranslations("Admin.disputes")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { get, sort, onSort, statusTabs, activeFilters } = useDisputeList()
    const sheet = useEntitySheet()

    const input = disputesListInput(get)

    const { data } = useSuspenseQuery(trpc.disputes.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.disputes.stats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.disputes.list.pathKey() }) > 0

    const { open } = sheet
    const onOpen = useCallback((row: DisputeRow) => open(row.id), [open])

    const columns = useDisputeColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.disputes.columns",
    })

    const [isExporting, setExporting] = useState(false)

    const exportRows = async (selected?: DisputeRow[]) => {
        setExporting(true)
        try {
            const rows = selected ?? await queryClient.fetchQuery(trpc.disputes.export.queryOptions(withoutPaging(input)))

            downloadCsv(
                `disputes-${stamp()}.csv`,
                ["Order", "Order status", "Reason", "Status", "Description", "Claimed", "Currency", "Liable", "Hold shipper", "Hold carrier", "Shipper", "Carrier", "Opened", "Opened by", "Resolved"],
                rows.map((row) => [
                    row.orderId, row.orderStatus, row.reason, row.status, row.description, row.claimedAmount, row.claimedCurrency, row.liableParty,
                    row.holdShipperPayments ? "yes" : "", row.holdCarrierPayments ? "yes" : "", row.shipperName, row.carrierName,
                    row.openedAt.toISOString().slice(0, 10), row.openedByName, row.resolvedAt?.toISOString().slice(0, 10),
                ]),
            )
        } finally {
            setExporting(false)
        }
    }

    const chips = activeFilters()

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    tabs={{ param: "status", items: statusTabs(stats) }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: DEFAULT_SORT,
                        defaultDir: DEFAULT_DIR,
                        options: DISPUTE_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    onExport={() => exportRows()}
                    isExporting={isExporting}
                    filters={<DisputeFilters />}
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={onOpen}
                        isFiltered={isFilteredDisputes(get)}
                        activeRowId={sheet.id}
                        empty={{
                            title: t("data.empty"),
                            description: t("data.empty-description"),
                            filtered: t("data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />

                <BulkBar table={table}>
                    <BulkAction onClick={() => exportRows(table.getSelectedRowModel().rows.map((row) => row.original))}>
                        {t("bulk.export")}
                    </BulkAction>
                </BulkBar>
            </ListCard>

            <DisputeSheet />
        </>
    )
}
