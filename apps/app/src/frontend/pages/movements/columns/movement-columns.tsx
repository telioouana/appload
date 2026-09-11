"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"

import { LaneCell, LastPingCell, LoadDate, Money, MovementStatusChip, RoleChip } from "@/frontend/pages/movements/components/badges"
import type { MovementRow, MovementScope, OrgType } from "@/frontend/pages/movements/types"

/**
 * Who else is on a row, from where the reader stands: the partner moving a
 * load the reader placed, the company that placed one with it or moves one
 * for it, the client an own-fleet trip is for.
 */
const partyOf = (row: MovementRow, scope: MovementScope) =>
    row.role === "owner" ? (scope === "trips" ? row.client : row.carrier) : row.owner

/**
 * Columns for both lists. A hook because the cells need translations and a
 * formatter; memoised so the table instance is not rebuilt — and every cell
 * remounted — on each render.
 *
 * The money columns follow the company: a shipper is never paid for a load,
 * and its own trucks earn it nothing, so it gets neither "to receive" nor,
 * on its trips, a client.
 */
export function useMovementColumns({ scope, orgType }: { scope: MovementScope; orgType: OrgType }) {
    const t = useTranslations("App.loads")
    const f = useFormatter()

    return useMemo<ColumnDef<MovementRow, unknown>[]>(() => {
        const carrier = orgType === "carrier"
        const partyHeader = scope === "trips" ? t("columns.client") : t("columns.partner")

        const columns: (ColumnDef<MovementRow, unknown> | false)[] = [
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
                size: 170,
                meta: { label: t("columns.status") },
                cell: ({ row }) => (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <MovementStatusChip status={row.original.status} execution={row.original.execution} />
                        <RoleChip role={row.original.role} />
                    </span>
                ),
            },
            {
                id: "lane",
                header: t("columns.lane"),
                size: 240,
                meta: { label: t("columns.lane") },
                cell: ({ row }) => <LaneCell origin={row.original.origin} destination={row.original.destination} />,
            },
            (scope === "orders" || carrier) && {
                id: "party",
                header: partyHeader,
                size: 180,
                meta: { label: partyHeader },
                cell: ({ row }) => {
                    const party = partyOf(row.original, scope)

                    return party?.name
                        ? <span className="truncate text-[13px]">{party.name}</span>
                        : <EmptyValue label={scope === "trips" ? t("values.own-account") : t("values.no-partner")} />
                },
            },
            {
                id: "rig",
                header: t("columns.rig"),
                size: 190,
                meta: { label: t("columns.rig") },
                cell: ({ row }) => {
                    const { driverName, truckPlate } = row.original

                    if (!driverName && !truckPlate) return <EmptyValue label={t("values.no-rig")} />

                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            {truckPlate && <PlateChip plate={truckPlate} />}
                            {driverName && <span className="truncate text-[13px]">{driverName}</span>}
                        </span>
                    )
                },
            },
            {
                id: "dates",
                header: t("columns.dates"),
                size: 160,
                meta: { label: t("columns.dates"), sortKey: "loading" },
                cell: ({ row }) => {
                    const { status, expectedLoadingDate, startedAt, expectedDeliveryAt, deliveredAt } = row.original

                    if (status === "delivered" || status === "closed") {
                        return <LoadDate value={deliveredAt} empty={t("values.no-date")} />
                    }

                    const left = status === "in-transit" ? startedAt : expectedLoadingDate

                    return (
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <LoadDate value={left} empty={t("values.no-date")} />
                            <span className="text-muted-foreground truncate text-xs">
                                {expectedDeliveryAt
                                    ? t("values.due", { date: f.dateTime(expectedDeliveryAt, { dateStyle: "medium" }) })
                                    : t("values.no-due-date")}
                            </span>
                        </div>
                    )
                },
            },
            carrier && {
                id: "receivable",
                header: t("columns.receivable"),
                size: 140,
                meta: { label: t("columns.receivable") },
                cell: ({ row }) => row.original.receivable
                    ? <Money className="text-[13px]" amount={row.original.receivable.total} currency={row.original.receivable.currency} />
                    : <EmptyValue label={t("values.no-price")} />,
            },
            scope === "orders" && {
                id: "payable",
                header: t("columns.payable"),
                size: 140,
                meta: { label: t("columns.payable") },
                cell: ({ row }) => row.original.payable
                    ? <Money className="text-[13px]" amount={row.original.payable.total} currency={row.original.payable.currency} />
                    : <EmptyValue label={t("values.no-price")} />,
            },
            {
                id: "lastPing",
                header: t("columns.last-ping"),
                size: 160,
                meta: { label: t("columns.last-ping") },
                cell: ({ row }) => <LastPingCell ping={row.original.lastPing} />,
            },
        ]

        return columns.filter((column): column is ColumnDef<MovementRow, unknown> => Boolean(column))
    }, [t, f, scope, orgType])
}
