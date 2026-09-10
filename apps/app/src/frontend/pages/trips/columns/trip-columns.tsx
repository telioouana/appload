"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { DriverCell, LaneCell, LastPingCell, TripDate, TripStatusChip } from "@/frontend/pages/trips/components/badges"
import type { TripRow } from "@/frontend/pages/trips/types"

/**
 * Columns for the trips table. A hook because the cells need translations
 * and a formatter; memoised so the table instance is not rebuilt — and every
 * cell remounted — on each render.
 *
 * The date column follows the trip: a load still waiting shows when it is
 * due, one on the road shows when it left, one that arrived shows when.
 */
export function useTripColumns() {
    const t = useTranslations("App.trips")
    const f = useFormatter()

    return useMemo<ColumnDef<TripRow, unknown>[]>(() => [
        {
            id: "ref",
            accessorKey: "ref",
            header: t("columns.ref"),
            enableHiding: false,
            size: 110,
            meta: { label: t("columns.ref") },
            cell: ({ row }) => <Mono className="font-medium">{row.original.ref}</Mono>,
        },
        {
            id: "status",
            header: t("columns.status"),
            enableHiding: false,
            size: 130,
            meta: { label: t("columns.status") },
            cell: ({ row }) => <TripStatusChip status={row.original.status} />,
        },
        {
            id: "driver",
            accessorKey: "driverName",
            header: t("columns.driver"),
            size: 190,
            meta: { label: t("columns.driver") },
            cell: ({ row }) => <DriverCell name={row.original.driverName} phone={row.original.driverPhone} />,
        },
        {
            id: "plate",
            header: t("columns.plate"),
            size: 120,
            meta: { label: t("columns.plate") },
            cell: ({ row }) =>
                row.original.truckPlate
                    ? <PlateChip plate={row.original.truckPlate} />
                    : <EmptyValue label={t("values.no-plate")} />,
        },
        {
            id: "lane",
            header: t("columns.lane"),
            size: 240,
            meta: { label: t("columns.lane") },
            cell: ({ row }) => <LaneCell origin={row.original.origin} destination={row.original.destination} />,
        },
        {
            id: "dates",
            header: t("columns.dates"),
            size: 150,
            meta: { label: t("columns.dates"), sortKey: "started" },
            cell: ({ row }) => {
                const { status, startedAt, expectedDeliveryAt, deliveredAt } = row.original

                if (status === "delivered") {
                    return <TripDate value={deliveredAt} empty={t("values.no-date")} />
                }

                return (
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <TripDate value={startedAt} empty={t("values.not-started")} />
                        <span className="text-muted-foreground truncate text-xs">
                            {expectedDeliveryAt
                                ? t("values.due", { date: f.dateTime(expectedDeliveryAt, { dateStyle: "medium" }) })
                                : t("values.no-due-date")}
                        </span>
                    </div>
                )
            },
        },
        {
            id: "partner",
            header: t("columns.partner"),
            size: 170,
            meta: { label: t("columns.partner") },
            cell: ({ row }) =>
                row.original.counterpartyName
                    ? <span className="truncate text-[13px]">{row.original.counterpartyName}</span>
                    : <EmptyValue label={t("values.own-load")} />,
        },
        {
            id: "lastPing",
            header: t("columns.last-ping"),
            size: 160,
            meta: { label: t("columns.last-ping") },
            cell: ({ row }) => <LastPingCell ping={row.original.lastPing} />,
        },
    ], [t, f])
}
