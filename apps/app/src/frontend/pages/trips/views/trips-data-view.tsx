"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useTripColumns } from "@/frontend/pages/trips/columns/trip-columns"
import { useTripsList } from "@/frontend/pages/trips/hooks/use-trips-list"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import { TripSheet } from "@/frontend/pages/trips/views/trip-sheet"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    isFilteredTrips,
    PAGE_SIZES,
    TRIP_SORTS,
    tripsListInput,
    type TripRow,
} from "@/frontend/pages/trips/types"

/**
 * The list card: the section strip, the table and the panel every row opens.
 * The table and the tiles read the same stats, so the counts above and the
 * rows below can never disagree.
 */
export function TripsDataView() {
    const t = useTranslations("App.trips")
    const trpc = useTRPC()

    const { get, sort, onSort, sectionTabs, activeFilters } = useTripsList()
    const sheet = useEntitySheet()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching
    const input = tripsListInput(get)

    const { data } = useSuspenseQuery(trpc.trips.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.trips.stats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.trips.list.pathKey() }) > 0

    const { open } = sheet
    const onOpen = useCallback((row: TripRow) => open(row.id), [open])

    const columns = useTripColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.trips.columns",
    })

    const chips = activeFilters()

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    tabs={{ param: "section", items: sectionTabs(stats) }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: DEFAULT_SORT,
                        defaultDir: DEFAULT_DIR,
                        options: TRIP_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    filters={
                        <div className="flex flex-col gap-1">
                            <FilterToggle
                                label={t("filters.no-response")}
                                hint={t("filters.no-response-hint")}
                                param="noResponse"
                                value="1"
                                count={stats.attention.noResponseToday}
                            />
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
                        isFiltered={isFilteredTrips(get)}
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

            <TripSheet allowance={session.allowance} organizationName={session.organization.name} />
        </>
    )
}
