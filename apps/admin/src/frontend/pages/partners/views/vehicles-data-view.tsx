"use client"

import { useCallback, useState } from "react"
import { useIsFetching, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"
import { OWNERSHIP_STATUS } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { today } from "@workspace/domain/kyc/derive"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { BulkAction, BulkBar } from "@workspace/ui/customs/list/bulk-bar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { FilterChoice, FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"
import { useVehicleColumns } from "@/frontend/pages/partners/columns/vehicle-columns"
import { isFilteredList, usePartnerList, withoutPaging } from "@/frontend/pages/partners/hooks/use-partner-list"
import { usePartnerProfile, type ProfileTab } from "@/frontend/pages/partners/hooks/use-partner-profile"
import { PartnerProfileSheet } from "@/frontend/pages/partners/views/partner-profile-sheet"
import {
    EXPIRY_WINDOW_DAYS,
    PAGE_SIZES,
    VEHICLE_SORTS,
    vehiclesListInput,
    type VehicleRow,
} from "@/frontend/pages/partners/types"

export function VehiclesDataView() {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { get, sort, onSort, statusTabs, activeFilters } = usePartnerList("plate")
    const profile = usePartnerProfile()

    const input = vehiclesListInput(get)

    const { data } = useSuspenseQuery(trpc.partners.vehicles.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.partners.vehicleStats.queryOptions({ kind: input.kind, owner: input.owner }))
    const isRefreshing = useIsFetching({ queryKey: trpc.partners.vehicles.pathKey() }) > 0

    const on = today()

    const { open } = profile
    const onOpen = useCallback((row: VehicleRow, tab?: ProfileTab) => open(row.id, tab), [open])

    const columns = useVehicleColumns({ today: on, onOpen })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: `appload.partners.${input.kind}.columns`,
    })

    const [isExporting, setExporting] = useState(false)

    const exportRows = async (selected?: VehicleRow[]) => {
        setExporting(true)
        try {
            const rows = selected ?? await queryClient.fetchQuery(trpc.partners.exportVehicles.queryOptions(withoutPaging(input)))

            downloadCsv(
                `${input.kind}s-${stamp()}.csv`,
                ["Plate", "Kind", "Brand", "Model", "Year", "Type", "Carrier", "Ownership", "Owner", "Driver", "Capacity (t)", "Status", "Documents approved", "Documents required", "Next expiry"],
                rows.map((row) => [
                    row.regPlate, row.kind, row.brand, row.model, row.year, row.truckType ?? "", row.carrierName ?? "",
                    row.ownershipStatus, row.ownerName ?? "", row.driverName ?? "", row.capacity ?? "",
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
                        defaultValue: "plate",
                        options: VEHICLE_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    onExport={() => exportRows()}
                    isExporting={isExporting}
                    filters={
                        <>
                            {/* Carriers when absent: the fleet somebody verifies */}
                            <FilterChoice
                                label={t("filters.owner")}
                                param="owner"
                                anyLabel={t("filters.owner-options.carrier")}
                                options={[
                                    { value: "shipper", label: t("filters.owner-options.shipper") },
                                    { value: "all", label: t("filters.owner-options.all") },
                                ]}
                            />
                            <FilterChoice
                                label={t("columns.ownership")}
                                param="ownership"
                                anyLabel={t("filters.any")}
                                options={OWNERSHIP_STATUS.map((value) => ({ value, label: t(`ownership.${value}`) }))}
                            />
                            <div className="flex flex-col gap-1 border-t pt-3">
                                <FilterToggle
                                    label={t("filters.expiring")}
                                    hint={t("filters.within-days", { days: EXPIRY_WINDOW_DAYS })}
                                    param="expiring"
                                    value={String(EXPIRY_WINDOW_DAYS)}
                                />
                                <FilterToggle
                                    label={t(`filters.unassigned-${input.kind}`)}
                                    hint={t(`filters.unassigned-${input.kind}-hint`)}
                                    param="unassigned"
                                    value="1"
                                />
                            </div>
                        </>
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
                            description: t(`data.empty-${input.kind}`),
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

            <PartnerProfileSheet subjectType={input.kind} />
        </>
    )
}
