"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { FilterToggle } from "@workspace/ui/customs/list/filter-controls"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { useStatusLabel } from "@/frontend/pages/movements/components/badges"
import { useMovementColumns } from "@/frontend/pages/movements/columns/movement-columns"
import { useMovementsList } from "@/frontend/pages/movements/hooks/use-movements-list"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    MOVEMENT_SORTS,
    PAGE_SIZES,
    STATUS_TABS,
    isFilteredMovements,
    movementsListInput,
    type MovementRow,
    type MovementScope,
    type MovementSection,
} from "@/frontend/pages/movements/types"

/**
 * The list card for one section, on one of the two tabs. Every row opens the
 * one shared load page — a trip that is handed to a partner later keeps its
 * address.
 *
 * The sections that hold several statuses cut by status in the toolbar: a
 * fixed set of tabs per side, zero counts included, so a tab never appears or
 * vanishes as loads move. The nine stages of a load in progress are too many
 * to line up, so there they are a menu.
 *
 * An empty list offers to file a load of the shape it lists — except a
 * transporter's own trucks, which are put on its clients' orders and never
 * filed by hand: there the empty state only says where they come from.
 */
export function MovementsDataView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads")
    const statusLabel = useStatusLabel()
    const trpc = useTRPC()
    const router = useRouter()

    const { get, sort, onSort } = useMovementsList()
    const { open: openNewLoad } = useNewLoad()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const orgType = session.organization.type

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching; it reads the tab too
    const input = movementsListInput(section, get, orgType)

    const { data } = useSuspenseQuery(trpc.movements.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope }))
    const isRefreshing = useIsFetching({ queryKey: trpc.movements.list.pathKey() }) > 0

    const onOpen = useCallback(
        (row: MovementRow) => router.push({ pathname: "/orders/load/[loadId]", params: { loadId: row.id } }),
        [router],
    )

    const columns = useMovementColumns({ scope, orgType })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: `appload.portal.${scope}.columns`,
    })

    // The sections are the rail's and the two sides are the page header's
    // pills; the toolbar's tabs are the statuses inside the section on
    // screen. A prospect waits on an answer whether it was asked by hand or
    // offered on the portal, so its tab counts both
    const statuses = STATUS_TABS[scope][section] ?? []
    const statusCount = (status: (typeof statuses)[number]) =>
        (stats.byStatus[status] ?? 0) + (status === "prospect" ? stats.byStatus.offered ?? 0 : 0)
    const tabs = statuses.length === 0 ? [] : [
        { value: "all", label: t("tabs.all"), count: stats.bySection[section] ?? 0 },
        ...statuses.map((status) => ({ value: status, label: statusLabel(status), count: statusCount(status) })),
    ]

    const chips = get("silent") === "1"
        ? [{ key: "silent", label: t("filters.tracking"), value: t("filters.silent") }]
        : []

    // A transporter's own trucks come from its clients; nobody files one
    const ownTripsFromClients = scope === "trips" && orgType === "carrier"

    return (
        <ListCard>
            <ListToolbar
                table={table}
                tabs={{ param: "status", items: tabs, as: section === "in-progress" ? "menu" : "tabs" }}
                filterCount={chips.length}
                activeFilters={chips}
                filters={
                    <div className="flex flex-col gap-1">
                        <FilterToggle
                            label={t("filters.silent")}
                            hint={t("filters.silent-hint")}
                            param="silent"
                            value="1"
                            count={stats.silent}
                        />
                    </div>
                }
                sort={{
                    defaultValue: DEFAULT_SORT,
                    defaultDir: DEFAULT_DIR,
                    options: MOVEMENT_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                }}
            />

            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                <DataTable
                    table={table}
                    sort={sort}
                    onSort={onSort}
                    onRowClick={onOpen}
                    selectable={false}
                    isFiltered={isFilteredMovements(get)}
                    empty={{
                        title: t(`data.empty.${scope}`),
                        description: section === "disputes"
                            ? t("data.empty-disputes")
                            : t(`data.empty-description.${ownTripsFromClients ? "trips-carrier" : scope}`),
                        filtered: t("data.no-results"),
                        action: ownTripsFromClients
                            ? undefined
                            : <Button onClick={() => openNewLoad(scope === "trips" ? "own-fleet" : "partner")}>{t(`actions.new.${scope}`)}</Button>,
                    }}
                />
            </div>

            <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
        </ListCard>
    )
}
