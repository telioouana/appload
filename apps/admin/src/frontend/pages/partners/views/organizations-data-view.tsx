"use client"

import { useCallback, useState } from "react"
import { useIsFetching, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { today } from "@/lib/kyc/derive"
import { ListCard } from "@/components/list/list-card"
import { ListFooter } from "@/components/list/list-footer"
import { ListToolbar } from "@/components/list/list-toolbar"
import { BulkAction, BulkBar } from "@/components/list/bulk-bar"
import { DataTable, useDataTable } from "@/components/list/data-table"
import { FilterChoice, FilterToggle } from "@/components/list/filter-controls"
import { downloadCsv, stamp } from "@/components/list/csv"
import { useOrganizationColumns } from "@/frontend/pages/partners/columns/organization-columns"
import { isFilteredList, usePartnerList, withoutPaging } from "@/frontend/pages/partners/hooks/use-partner-list"
import { usePartnerProfile, type ProfileTab } from "@/frontend/pages/partners/hooks/use-partner-profile"
import { PartnerProfileSheet } from "@/frontend/pages/partners/views/partner-profile-sheet"
import {
    CONTRACT_FILTERS,
    EXPIRY_WINDOW_DAYS,
    ORGANIZATION_SORTS,
    organizationsListInput,
    PAGE_SIZES,
    RISK_FILTERS,
    type OrgRow,
} from "@/frontend/pages/partners/types"

export function OrganizationsDataView({ type }: { type: "shipper" | "carrier" }) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { get, sort, onSort, statusTabs, activeFilters } = usePartnerList("name")
    const profile = usePartnerProfile()

    const input = { ...organizationsListInput(get), type }

    const { data } = useSuspenseQuery(trpc.partners.organizations.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.partners.organizationStats.queryOptions({ type }))
    const { data: provinces } = useQuery(trpc.partners.organizationProvinces.queryOptions({ type }))
    const isRefreshing = useIsFetching({ queryKey: trpc.partners.organizations.pathKey() }) > 0

    const on = today()

    const { open } = profile
    const onOpen = useCallback((row: OrgRow, tab?: ProfileTab) => open(row.id, tab), [open])

    const columns = useOrganizationColumns({ type, today: on, onOpen })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: `appload.partners.${type}.columns`,
    })

    const [isExporting, setExporting] = useState(false)

    const exportRows = async (selected?: OrgRow[]) => {
        setExporting(true)
        try {
            const rows = selected ?? await queryClient.fetchQuery(trpc.partners.exportOrganizations.queryOptions(withoutPaging(input)))

            downloadCsv(
                `${type}s-${stamp()}.csv`,
                ["Name", "NUIT", "Email", "Phone", "City", "Status", "Contract", "Risk", "Documents approved", "Documents required", "Next expiry", "Active orders", "Total orders", "Payments settled", "On-time", "Trucks", "Drivers"],
                rows.map((row) => [
                    row.name, row.nuit, row.email, row.phoneNumber, row.city, row.kycStatus, row.contract ?? "", row.riskLevel,
                    row.progress.approved, row.progress.required, row.nextExpiry ?? "", row.activeOrders, row.totalOrders,
                    row.settledRate === null ? "" : Math.round(row.settledRate * 100), row.onTimeRate === null ? "" : Math.round(row.onTimeRate * 100),
                    row.fleetSize, row.driverCount,
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
                        options: ORGANIZATION_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    onExport={() => exportRows()}
                    isExporting={isExporting}
                    filters={
                        <>
                            {type === "carrier" && (
                                <FilterChoice
                                    label={t("columns.contract")}
                                    param="contract"
                                    anyLabel={t("filters.any")}
                                    options={CONTRACT_FILTERS.map((value) => ({ value, label: t(`filters.contract-options.${value}`) }))}
                                />
                            )}
                            <FilterChoice
                                label={t("columns.risk")}
                                param="risk"
                                anyLabel={t("filters.any")}
                                options={RISK_FILTERS.map((value) => ({ value, label: t(`filters.risk-options.${value}`) }))}
                            />
                            {provinces && provinces.length > 0 && (
                                <FilterChoice
                                    label={t("filters.province")}
                                    param="province"
                                    anyLabel={t("filters.any")}
                                    options={provinces.map((entry) => ({ value: entry.province, label: entry.province, count: entry.count }))}
                                />
                            )}
                            <div className="flex flex-col gap-1 border-t pt-3">
                                <FilterToggle
                                    label={t("filters.expiring")}
                                    hint={t("filters.within-days", { days: EXPIRY_WINDOW_DAYS })}
                                    param="expiring"
                                    value={String(EXPIRY_WINDOW_DAYS)}
                                />
                                <FilterToggle
                                    label={t("filters.incomplete")}
                                    hint={t("filters.incomplete-hint")}
                                    param="incomplete"
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
                            description: t(`data.empty-${type}`),
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

            <PartnerProfileSheet subjectType="organization" />
        </>
    )
}
