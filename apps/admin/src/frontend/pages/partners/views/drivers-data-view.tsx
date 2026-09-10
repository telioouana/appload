"use client"

import { useCallback, useState } from "react"
import { useIsFetching, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { today } from "@workspace/domain/kyc/derive"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { BulkAction, BulkBar } from "@workspace/ui/customs/list/bulk-bar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"
import { useDriverColumns } from "@/frontend/pages/partners/columns/driver-columns"
import { isFilteredList, usePartnerList, withoutPaging } from "@/frontend/pages/partners/hooks/use-partner-list"
import { usePartnerProfile, type ProfileTab } from "@/frontend/pages/partners/hooks/use-partner-profile"
import { PartnerProfileSheet } from "@/frontend/pages/partners/views/partner-profile-sheet"
import {
    DRIVER_SORTS,
    driversListInput,
    EXPIRY_WINDOW_DAYS,
    PAGE_SIZES,
    type DriverRow,
} from "@/frontend/pages/partners/types"

export function DriversDataView() {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { get, sort, onSort, statusTabs, activeFilters } = usePartnerList("name")
    const profile = usePartnerProfile()

    const input = driversListInput(get)

    const { data } = useSuspenseQuery(trpc.partners.drivers.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.partners.driverStats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.partners.drivers.pathKey() }) > 0

    const on = today()

    const { open } = profile
    const onOpen = useCallback((row: DriverRow, tab?: ProfileTab) => open(row.id, tab), [open])

    const columns = useDriverColumns({ today: on, onOpen })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.partners.drivers.columns",
    })

    const [isExporting, setExporting] = useState(false)

    const exportRows = async (selected?: DriverRow[]) => {
        setExporting(true)
        try {
            const rows = selected ?? await queryClient.fetchQuery(trpc.partners.exportDrivers.queryOptions(withoutPaging(input)))

            downloadCsv(
                `drivers-${stamp()}.csv`,
                ["Name", "Passport", "Phone", "Email", "Carrier", "Truck", "Status", "Documents approved", "Documents required", "Next expiry"],
                rows.map((row) => [
                    row.name, row.passport ?? "", row.phoneNumber ?? "", row.email, row.carrierName ?? "", row.plate ?? "",
                    row.kycStatus, row.progress.approved, row.progress.required, row.nextExpiry ?? "",
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
                        defaultValue: "name",
                        options: DRIVER_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    onExport={() => exportRows()}
                    isExporting={isExporting}
                    filters={
                        <div className="flex flex-col gap-1">
                            <FilterToggle
                                label={t("filters.expiring")}
                                hint={t("filters.within-days", { days: EXPIRY_WINDOW_DAYS })}
                                param="expiring"
                                value={String(EXPIRY_WINDOW_DAYS)}
                            />
                            <FilterToggle label={t("filters.no-phone")} hint={t("filters.no-phone-hint")} param="phone" value="missing" />
                            <FilterToggle label={t("filters.no-truck")} hint={t("filters.no-truck-hint")} param="unassigned" value="1" />
                        </div>
                    }
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={(row) => onOpen(row)}
                        isFiltered={isFilteredList(get)}
                        activeRowId={profile.id}
                        empty={{
                            title: t("data.empty"),
                            description: t("data.empty-driver"),
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

            <PartnerProfileSheet subjectType="driver" />
        </>
    )
}
