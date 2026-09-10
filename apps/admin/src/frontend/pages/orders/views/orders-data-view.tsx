"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useIsFetching, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { today } from "@workspace/domain/kyc/derive"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { BulkAction, BulkBar } from "@workspace/ui/customs/list/bulk-bar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"
import { UpdateOrderView } from "@/frontend/pages/order/views/update-order-view"
import { BulkSendPdfDialog } from "@/frontend/pages/order/components/bulk-send-pdf-dialog"
import { useOrderColumns } from "@/frontend/pages/orders/columns/order-columns"
import { BulkTransitionDialog } from "@/frontend/pages/orders/components/bulk-transition-dialog"
import { TransitionDialog } from "@/frontend/pages/orders/components/transition-dialog"
import { useOrderActions } from "@/frontend/pages/orders/hooks/use-order-actions"
import { useOrderList } from "@/frontend/pages/orders/hooks/use-order-list"
import { useOrderSheet } from "@/frontend/pages/orders/hooks/use-order-sheet"
import { OrderFilters } from "@/frontend/pages/orders/sections/order-filters"
import { place } from "@/frontend/pages/orders/sections/order-item-shared"
import { OrderSheet } from "@/frontend/pages/orders/views/order-sheet"
import {
    currentYear,
    DEFAULT_DIR,
    DEFAULT_SORT,
    isFilteredOrders,
    ORDER_SORTS,
    ordersListInput,
    PAGE_SIZES,
    withoutPaging,
    type OrderRow,
    type OrderStatus,
    type Section,
} from "@/frontend/pages/orders/types"

export function OrdersDataView({ section }: { section: Section }) {
    const t = useTranslations("Admin.orders")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { get, sort, onSort, statusTabs, activeFilters } = useOrderList()
    const sheet = useOrderSheet()
    const { edit } = useOrderActions()

    const input = ordersListInput(section, get)
    const year = input.year ?? currentYear()

    const { data } = useSuspenseQuery(trpc.orders.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.orders.stats.queryOptions({ year }))
    const { data: options } = useQuery(trpc.orders.filterOptions.queryOptions({ year }))
    const isRefreshing = useIsFetching({ queryKey: trpc.orders.list.pathKey() }) > 0

    const on = today()

    // One transition dialog for the whole table, aimed at whichever row asked
    const [dialog, setDialog] = useState<{ orderId: string; to?: OrderStatus } | null>(null)
    // The bulk dialogs act on a snapshot of the selection taken when opened
    const [bulk, setBulk] = useState<{ kind: "transition" | "pdf"; rows: OrderRow[] } | null>(null)

    const { open } = sheet
    const onOpen = useCallback((row: OrderRow) => open(row.orderId), [open])
    const onEdit = useCallback((row: OrderRow) => { void edit(row.orderId, row.status) }, [edit])
    // Booking is the transition dialog aimed at booked, where the offer is
    // picked; a prospect with nothing to accept goes to its offers instead
    const onAccept = useCallback((row: OrderRow) => setDialog({ orderId: row.orderId, to: "booked" }), [])
    const onAddOffer = useCallback((row: OrderRow) => open(row.orderId, "offers"), [open])
    const onTransition = useCallback((row: OrderRow, to?: OrderStatus) => setDialog({ orderId: row.orderId, to }), [])

    const columns = useOrderColumns({ today: on, onOpen, onEdit, onAccept, onAddOffer, onTransition })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.orderId,
        storageKey: "appload.orders.columns",
    })

    const selected = () => table.getSelectedRowModel().rows.map((row) => row.original)

    const [isExporting, setExporting] = useState(false)

    const exportRows = async (rows?: OrderRow[]) => {
        setExporting(true)
        try {
            const items = rows ?? await queryClient.fetchQuery(trpc.orders.export.queryOptions(withoutPaging(input)))

            downloadCsv(
                `orders-${section}-${stamp()}.csv`,
                [
                    "Order", "Status", "Category", "Description", "Weight", "Unit", "Hazardous", "Refrigerated",
                    "From", "To", "Distance (km)", "Route", "Trip", "Expected loading", "Expected offloading", "Actual loading", "Actual offloading",
                    "Shipper", "Shipper invoice", "Shipper total", "Shipper currency", "Shipper payment", "Shipper remaining",
                    "Carrier", "Carrier invoice", "Carrier total", "Carrier currency", "Carrier payment", "Carrier remaining",
                    "Driver", "Driver phone", "Truck", "Trailer", "POD", "Flagged",
                ],
                items.map((row) => [
                    row.orderId, row.status, row.category, row.description, row.weight, row.weightUnit, row.isHazardous ? "yes" : "", row.isRefrigerated ? "yes" : "",
                    place(row.loadingAddress), place(row.offloadingAddress), row.distance, row.route, row.tripType,
                    row.expectedLoadingDate.toISOString().slice(0, 10), row.expectedOffloadingDate?.toISOString().slice(0, 10),
                    row.actualLoadingDate?.toISOString().slice(0, 10), row.actualOffloadingDate?.toISOString().slice(0, 10),
                    row.shipperName, row.shipperInvoiceNumber, row.shipperTotal, row.shipperCurrency, row.shipperPaymentStatus, row.shipperRemainingAmount,
                    row.carrierName, row.carrierInvoiceNumber, row.carrierTotal, row.carrierCurrency, row.carrierPaymentStatus, row.carrierRemainingAmount,
                    row.driverName, row.driverPhoneNumber, row.truckPlate, row.trailerPlate, row.podStatus, row.flaggedForReview ? "yes" : "",
                ]),
            )
        } finally {
            setExporting(false)
        }
    }

    const copyIds = () => {
        const ids = selected().map((row) => row.orderId)
        navigator.clipboard.writeText(ids.join("\n"))
            .then(() => toast(t("list.bulk.copied", { count: ids.length })))
            .catch(() => undefined)
    }

    const chips = activeFilters(options)

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    tabs={{ param: "status", items: statusTabs(section, stats), as: "menu" }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: DEFAULT_SORT,
                        defaultDir: DEFAULT_DIR,
                        options: ORDER_SORTS.map((value) => ({ value, label: t(`list.sort.${value}`) })),
                    }}
                    onExport={() => exportRows()}
                    isExporting={isExporting}
                    filters={<OrderFilters stats={stats} options={options} />}
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={onOpen}
                        isFiltered={isFilteredOrders(get)}
                        activeRowId={sheet.id}
                        empty={{
                            title: t("list.data.empty"),
                            description: t("list.data.empty-description"),
                            filtered: t("list.data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />

                <BulkBar table={table}>
                    <BulkAction onClick={() => setBulk({ kind: "transition", rows: selected() })}>{t("list.bulk.change-status")}</BulkAction>
                    <BulkAction onClick={() => setBulk({ kind: "pdf", rows: selected() })}>{t("list.bulk.send-pdfs")}</BulkAction>
                    <BulkAction onClick={() => exportRows(selected())}>{t("list.bulk.export")}</BulkAction>
                    <BulkAction onClick={copyIds}>{t("list.bulk.copy-ids")}</BulkAction>
                </BulkBar>
            </ListCard>

            <OrderSheet />

            {/* The tabbed edit sheet, shared with the details page */}
            <UpdateOrderView />

            {dialog && (
                <TransitionDialog
                    orderId={dialog.orderId}
                    open
                    initialTarget={dialog.to}
                    onClose={() => setDialog(null)}
                />
            )}

            {bulk?.kind === "transition" && (
                <BulkTransitionDialog
                    rows={bulk.rows}
                    open
                    onClose={() => setBulk(null)}
                    onDone={(results) => {
                        // Rows that moved leave the selection; failed ones stay for a retry
                        const moved = new Set(results.filter((result) => result.ok).map((result) => result.orderId))
                        table.setRowSelection((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !moved.has(id))))
                    }}
                />
            )}

            {bulk?.kind === "pdf" && (
                <BulkSendPdfDialog rows={bulk.rows} open onClose={() => setBulk(null)} />
            )}
        </>
    )
}
