"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, Mono, StackCell } from "@/components/list/table-cells"
import { OrderStatusBadge } from "@/frontend/pages/orders/sections/order-item-shared"
import { DisputeReasonBadge, DisputeStatusBadge, HoldChips } from "@/frontend/pages/disputes/sections/dispute-badges"
import type { DisputeRow } from "@/frontend/pages/disputes/types"

/** Column definitions for the disputes table; memoised on the translators. */
export function useDisputeColumns() {
    const t = useTranslations("Admin.disputes")
    const f = useFormatter()

    return useMemo<ColumnDef<DisputeRow, unknown>[]>(() => [
        {
            id: "order",
            accessorKey: "orderId",
            header: t("columns.order"),
            enableHiding: false,
            size: 170,
            meta: { label: t("columns.order") },
            cell: ({ row }) => (
                <div className="flex min-w-0 flex-col items-start gap-1">
                    <Mono className="font-medium">{row.original.orderId}</Mono>
                    <OrderStatusBadge status={row.original.orderStatus} className="px-1.5 py-0.5 text-xs" />
                </div>
            ),
        },
        {
            id: "reason",
            accessorKey: "reason",
            header: t("columns.reason"),
            size: 130,
            meta: { label: t("columns.reason") },
            cell: ({ row }) => (
                <StackCell
                    primary={<DisputeReasonBadge reason={row.original.reason} />}
                    secondary={<span className="line-clamp-2 whitespace-normal">{row.original.description}</span>}
                />
            ),
        },
        {
            id: "parties",
            header: t("columns.parties"),
            size: 200,
            meta: { label: t("columns.parties") },
            cell: ({ row }) => (
                <StackCell
                    primary={<span className="truncate">{row.original.shipperName}</span>}
                    secondary={row.original.carrierName ?? <span className="text-muted-foreground">{t("values.no-carrier")}</span>}
                />
            ),
        },
        {
            id: "claimed",
            accessorKey: "claimedAmount",
            header: t("columns.claimed"),
            size: 130,
            meta: { label: t("columns.claimed"), sortKey: "claimed", align: "right" },
            cell: ({ row }) =>
                row.original.claimedAmount === null
                    ? <Dash />
                    : (
                        <span className="tabular-nums">
                            {f.number(Number(row.original.claimedAmount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.original.claimedCurrency ?? ""}
                        </span>
                    ),
        },
        {
            id: "holds",
            header: t("columns.holds"),
            size: 150,
            meta: { label: t("columns.holds") },
            cell: ({ row }) => <HoldChips shipper={row.original.holdShipperPayments} carrier={row.original.holdCarrierPayments} />,
        },
        {
            id: "liable",
            accessorKey: "liableParty",
            header: t("columns.liable"),
            size: 110,
            meta: { label: t("columns.liable") },
            cell: ({ row }) => (row.original.liableParty ? t(`values.liable.${row.original.liableParty}`) : <Dash />),
        },
        {
            id: "opened",
            accessorKey: "openedAt",
            header: t("columns.opened"),
            size: 130,
            meta: { label: t("columns.opened"), sortKey: "opened" },
            cell: ({ row }) => (
                <StackCell
                    primary={<span className="tabular-nums">{f.dateTime(row.original.openedAt, { day: "numeric", month: "short" })}</span>}
                    secondary={row.original.openedByName ?? undefined}
                />
            ),
        },
        {
            id: "status",
            accessorKey: "status",
            header: t("columns.status"),
            size: 120,
            meta: { label: t("columns.status"), sortKey: "status" },
            cell: ({ row }) => <DisputeStatusBadge status={row.original.status} />,
        },
    ], [t, f])
}
