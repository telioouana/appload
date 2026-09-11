"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"
import { OWNERSHIP_STATUS } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { useVerifiedFleet } from "@/frontend/pages/fleet/hooks/use-verified-fleet"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { FilterChoice, FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { useVehicleColumns } from "@/frontend/pages/fleet/columns/vehicle-columns"
import { VehicleProfileSheet } from "@/frontend/pages/fleet/views/vehicle-profile-sheet"
import { isFilteredList, useFleetList } from "@/frontend/pages/fleet/hooks/use-fleet-list"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import {
    FLEET_STATES,
    PAGE_SIZES,
    VEHICLE_SORTS,
    vehiclesListInput,
    type VehicleKind,
    type VehicleRow,
} from "@/frontend/pages/fleet/types"

export function VehiclesDataView({ kind }: { kind: VehicleKind }) {
    const t = useTranslations("App.fleet")
    const trpc = useTRPC()

    const { get, sort, onSort, statusTabs, activeFilters } = useFleetList(kind)
    const sheet = useEntitySheet()

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching
    const input = vehiclesListInput(kind, get)

    const { data } = useSuspenseQuery(trpc.fleet.vehicles.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.fleet.vehicles.stats.queryOptions({ kind }))
    const isRefreshing = useIsFetching({ queryKey: trpc.fleet.vehicles.list.pathKey() }) > 0

    const { open } = sheet
    const onOpen = useCallback((row: VehicleRow) => open(row.id), [open])

    const verified = useVerifiedFleet()
    const columns = useVehicleColumns({ kind, onOpen, verified })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: `appload.portal.fleet.${kind}.columns`,
    })

    const chips = activeFilters()

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    // Verification statuses only exist where Appload verifies;
                    // a shipper's list keeps the one tab that counts it
                    tabs={{ param: "status", items: statusTabs(stats).filter((tab) => verified || tab.value === "all") }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: "plate",
                        options: VEHICLE_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
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
                            {verified && (
                                <FilterChoice
                                    label={t("filters.ownership")}
                                    param="ownership"
                                    anyLabel={t("filters.any")}
                                    options={OWNERSHIP_STATUS.map((value) => ({ value, label: t(`ownership.${value}`) }))}
                                />
                            )}
                            <div className="flex flex-col gap-1 border-t pt-3">
                                <FilterToggle
                                    label={t(`filters.unassigned.${kind}`)}
                                    hint={t(`filters.unassigned-hint.${kind}`)}
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
                            description: t(`data.empty-description.${kind}`),
                            filtered: t("data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>

            {/* Editing lives in the profile panel, which holds the whole row:
                the list does not carry the VIN, and a dialog that seeded it
                blank would force the user to retype it to save anything */}
            <VehicleProfileSheet kind={kind} />
        </>
    )
}
