"use client"

import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@/components/list/list-card"
import { ListFooter } from "@/components/list/list-footer"
import { ListToolbar } from "@/components/list/list-toolbar"
import { DataTable, useDataTable } from "@/components/list/data-table"
import { downloadCsv, stamp } from "@/components/list/csv"
import { usePartyColumns } from "@/frontend/pages/kpis/columns/party-columns"
import { useKpiList } from "@/frontend/pages/kpis/hooks/use-kpi-list"
import { KPI_SORTS, listInput, statsInput, type KpiPartyRow } from "@/frontend/pages/kpis/types"
import { PAGE_SIZES } from "@/frontend/pages/partners/types"

/**
 * The list card: every shipper — or carrier — that moved something in the
 * period, ranked, one page at a time. This is the page before a report
 * exists, so a row is a door: clicking it pushes the party's own route and
 * the browser keeps this list where it was.
 *
 * The tabs are the side of the trade rather than a status, and they carry
 * both counts at once — the tab you are not reading still says how much is
 * behind it. The tiles above and these counts are the whole period, not the
 * page on screen.
 */
export function KpisDataView() {
    const t = useTranslations("Admin.kpis")
    const trpc = useTRPC()

    const { get, sort, onSort, open } = useKpiList()

    // The same builders the RSC page prefetched with, from the same URL —
    // hand-writing either object here is how a page fetches its rows twice
    const input = listInput(get)

    const { data } = useSuspenseQuery(trpc.kpis.parties.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.kpis.stats.queryOptions(statsInput(get)))
    const isRefreshing = useIsFetching({ queryKey: trpc.kpis.parties.pathKey() }) > 0

    const columns = usePartyColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.kpis.columns",
    })

    // The page on screen, not the whole ranking, and only the columns left
    // showing: the reader exports what they are looking at. The period goes
    // into the name as its two days — a file name is no place for "1 Jan 2026
    // – 7 Sep 2026" — and the side of the trade in the reader's own language
    const exportRows = () => {
        // What each column holds, keyed by the column it belongs to, so
        // hiding one in the Columns menu drops it from the file too
        const cell: Record<string, (row: KpiPartyRow) => string | number> = {
            name: (row) => row.name,
            transports: (row) => row.transports,
            onTime: (row) => (row.onTimeOffloadingRate === null ? "" : Math.round(row.onTimeOffloadingRate * 100)),
            price: (row) => (row.pricePerTransport === null ? "" : Math.round(row.pricePerTransport)),
            costPerKm: (row) => (row.costPerKm === null ? "" : Math.round(row.costPerKm * 100) / 100),
            deliveries: (row) => row.deliveries,
            tons: (row) => Math.round(row.tons * 10) / 10,
        }

        const visible = table.getVisibleLeafColumns()

        downloadCsv(
            `${t("export.filename", { type: t(`type.${input.type}`), period: `${input.from}_${input.to}` })}-${stamp()}.csv`,
            visible.map((column) => column.columnDef.meta?.label ?? column.id),
            data.items.map((row) => visible.map((column) => cell[column.id]?.(row) ?? "")),
        )
    }

    return (
        <ListCard>
            <ListToolbar
                table={table}
                tabs={{
                    param: "type",
                    // Shippers first: the toolbar clears the param for its
                    // first tab, and shippers are what an absent `type` means
                    items: [
                        { value: "shipper", label: t("type.shipper"), count: stats.shippers },
                        { value: "carrier", label: t("type.carrier"), count: stats.carriers },
                    ],
                }}
                sort={{
                    defaultValue: "transports",
                    defaultDir: "desc",
                    options: KPI_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                }}
                onExport={exportRows}
            />

            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                <DataTable
                    table={table}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={(row) => open(row.id)}
                    selectable={false}
                    isFiltered={Boolean(get("search"))}
                    empty={{
                        title: t("empty.title"),
                        description: t("empty.description"),
                        filtered: t("empty.filtered"),
                    }}
                />
            </div>

            <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
        </ListCard>
    )
}
