"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { FilterChoice, FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { useDriverColumns } from "@/frontend/pages/drivers/columns/driver-columns"
import { DriverProfileSheet } from "@/frontend/pages/drivers/views/driver-profile-sheet"
import { isFilteredList, useDriversList } from "@/frontend/pages/drivers/hooks/use-drivers-list"
import { useDriverSheet } from "@/frontend/pages/drivers/hooks/use-driver-sheet"
import {
    DRIVER_SORTS,
    driversListInput,
    FLEET_STATES,
    PAGE_SIZES,
    type DriverRow,
} from "@/frontend/pages/drivers/types"

export function DriversDataView() {
    const t = useTranslations("App.drivers")
    const trpc = useTRPC()

    const { get, sort, onSort, statusTabs, activeFilters } = useDriversList()
    const sheet = useDriverSheet()

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching
    const input = driversListInput(get)

    const { data } = useSuspenseQuery(trpc.drivers.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.drivers.stats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.drivers.list.pathKey() }) > 0

    const { open } = sheet
    const onOpen = useCallback((row: DriverRow) => open(row.id), [open])

    const columns = useDriverColumns({ onOpen })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.drivers.columns",
    })

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
                    filters={
                        <div className="flex flex-col gap-3">
                            <FilterChoice
                                label={t("filters.state")}
                                param="state"
                                anyLabel={t("filters.any")}
                                options={FLEET_STATES.map((value) => ({
                                    value,
                                    label: t(`state.${value}`),
                                    count: stats.byState[value],
                                }))}
                            />
                            <div className="flex flex-col gap-1 border-t pt-3">
                                <FilterToggle
                                    label={t("filters.unassigned")}
                                    hint={t("filters.unassigned-hint")}
                                    param="unassigned"
                                    value="1"
                                    count={stats.attention.unassigned}
                                />
                            </div>
                        </div>
                    }
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={onOpen}
                        selectable={false}
                        isFiltered={isFilteredList(get)}
                        activeRowId={sheet.id}
                        empty={{
                            title: t("data.empty"),
                            description: t("data.empty-description"),
                            filtered: t("data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>

            <DriverProfileSheet />
        </>
    )
}
