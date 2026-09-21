"use client"

import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useIsFetching, useQueryClient, useSuspenseQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { IconDownload } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { FilterChoice } from "@workspace/ui/customs/list/filter-controls"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { Dash, Mono } from "@workspace/ui/customs/list/table-cells"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { LaneCell, LoadDate, Money, MovementStatusChip } from "@/frontend/pages/movements/components/badges"
import { downloadLoadsCsv } from "@/frontend/pages/movements/lib/export-csv"
import { PeriodFilter } from "@/frontend/pages/movements/sections/movement-filters"
import { PAGE_SIZES } from "@/frontend/pages/movements/types"
import { reportInput } from "@/frontend/pages/reports/types"

/**
 * The trip report: the company's own loads over a loading period, each row
 * carrying its revenue, its recorded costs and its margin, with the
 * period's totals per currency above them. The detailed cost lines live in
 * each load's own window; this is the page that adds them up.
 */
export function ReportView() {
    const t = useTranslations("App.reports")
    const tf = useTranslations("App.loads.filters")
    const trpc = useTRPC()
    const router = useRouter()
    const searchParams = useSearchParams()

    const input = reportInput((key) => searchParams.get(key))

    const { data } = useSuspenseQuery(trpc.movements.costReport.queryOptions(input))
    const { data: options } = useQuery(trpc.movements.formOptions.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.movements.costReport.pathKey() }) > 0

    type ReportItem = (typeof data)["items"][number]

    const onOpen = useCallback(
        (row: ReportItem) => router.push({ pathname: "/orders/load/[loadId]", params: { loadId: row.id } }),
        [router],
    )

    const columns = useMemo<ColumnDef<ReportItem>[]>(() => [
        {
            id: "ref",
            header: t("columns.load"),
            enableHiding: false,
            size: 130,
            meta: { label: t("columns.load") },
            cell: ({ row }) => <Mono>{row.original.ref}</Mono>,
        },
        {
            id: "status",
            header: t("columns.status"),
            size: 150,
            meta: { label: t("columns.status") },
            cell: ({ row }) => <MovementStatusChip status={row.original.status} />,
        },
        {
            id: "lane",
            header: t("columns.lane"),
            size: 220,
            meta: { label: t("columns.lane") },
            cell: ({ row }) => <LaneCell origin={row.original.origin} destination={row.original.destination} />,
        },
        {
            id: "partner",
            header: t("columns.partner"),
            size: 170,
            meta: { label: t("columns.partner") },
            cell: ({ row }) => {
                const name = row.original.client?.name ?? row.original.carrier?.name
                return name ? <span className="truncate text-[13px]">{name}</span> : <Dash />
            },
        },
        {
            id: "loading",
            header: t("columns.loading"),
            size: 120,
            meta: { label: t("columns.loading") },
            cell: ({ row }) => <LoadDate value={row.original.expectedLoadingDate} empty="—" />,
        },
        {
            id: "revenue",
            header: t("columns.revenue"),
            size: 130,
            meta: { label: t("columns.revenue") },
            cell: ({ row }) =>
                row.original.receivable
                    ? <Money amount={row.original.receivable.total} currency={row.original.receivable.currency} className="text-[13px]" />
                    : <Dash />,
        },
        {
            id: "costs",
            header: t("columns.costs"),
            size: 140,
            meta: { label: t("columns.costs") },
            cell: ({ row }) =>
                row.original.costTotals.length === 0 ? <Dash /> : (
                    <span className="flex flex-col gap-0.5">
                        {row.original.costTotals.map((line) => (
                            <Money key={line.currency} amount={line.total} currency={line.currency} className="text-[13px]" />
                        ))}
                    </span>
                ),
        },
        {
            id: "margin",
            header: t("columns.margin"),
            size: 130,
            meta: { label: t("columns.margin") },
            cell: ({ row }) =>
                row.original.margin
                    ? (
                        <Money
                            amount={row.original.margin.amount}
                            currency={row.original.margin.currency}
                            className={cn("text-[13px]", row.original.margin.amount < 0 && "text-destructive")}
                        />
                    )
                    : <Dash />,
        },
    ], [t])

    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.report.columns",
    })

    const metrics: MoneyMetric[] = [
        { key: "revenue", label: t("columns.revenue"), kind: "amount", tone: "positive" },
        { key: "costs", label: t("columns.costs"), kind: "amount", tone: "negative" },
        { key: "margin", label: t("columns.margin"), kind: "amount", tone: "signed", emphasis: true },
    ]

    const lines: MoneyLine[] = data.lines.map((line) => ({
        currency: line.currency,
        values: { revenue: line.revenue, costs: line.costs, margin: line.margin },
    }))

    const queryClient = useQueryClient()
    const [isExporting, setExporting] = useState(false)

    const exportRows = async () => {
        setExporting(true)
        try {
            // The report's own rows in one pull, under the list export's cap
            const full = await queryClient.fetchQuery(
                trpc.movements.costReport.queryOptions({ ...input, page: 1, pageSize: 2000 }),
            )
            downloadLoadsCsv("cost-report", full.items)
        } finally {
            setExporting(false)
        }
    }

    const isFiltered = Boolean(input.partner || input.month || input.from || input.to)

    return (
        <>
            <PageHeader title={t("title")} count={data.total} description={t("description")} />

            <MoneyStrip title={t("title")} metrics={metrics} lines={lines} empty={t("empty")} />

            <ListCard>
                <div className="flex flex-col gap-4 border-b px-4 py-3 md:flex-row md:items-end">
                    <div className="grid flex-1 gap-4 md:max-w-xl md:grid-cols-2">
                        <PeriodFilter />
                        <FilterChoice
                            label={tf("partner")}
                            param="partner"
                            anyLabel={tf("any")}
                            options={(options?.partners ?? []).map((partner) => ({ value: partner.id, label: partner.name }))}
                        />
                    </div>

                    <Button variant="outline" size="sm" onClick={exportRows} disabled={isExporting}>
                        {isExporting ? <Spinner className="size-4" /> : <IconDownload className="size-4" stroke={1.5} />}
                        {t("export")}
                    </Button>
                </div>

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        onRowClick={onOpen}
                        selectable={false}
                        isFiltered={isFiltered}
                        empty={{ title: t("empty"), description: t("description"), filtered: t("no-results") }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>
        </>
    )
}
