"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { IconAlertTriangle, IconArrowRight, IconFlag, IconGavel, IconSnowflake } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Mono, PlateChip, StackCell } from "@/components/list/table-cells"
import { useMoney } from "@/frontend/pages/orders/sections/order-item-parts"
import { OrderStatusBadge, PaymentStatusChip, place } from "@/frontend/pages/orders/sections/order-item-shared"
import { OrderRowActions, type RowCallbacks } from "@/frontend/pages/orders/sections/order-row-actions"
import { daysLate, PRE_LOADING_STATUSES, type OrderRow } from "@/frontend/pages/orders/types"

/**
 * Column definitions for the orders table. A hook because the cells need
 * translations and formatters; memoised on stable callbacks so the table
 * instance is not rebuilt on every render (a rebuilt column array remounts
 * every cell).
 */
export function useOrderColumns({ today, onOpen, onConfirm, onEdit, onTransition }: { today: string } & RowCallbacks) {
    const t = useTranslations("Admin.orders")
    const f = useFormatter()
    const money = useMoney()

    return useMemo<ColumnDef<OrderRow, unknown>[]>(() => {
        const day = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })
        const muted = (label: string) => <span className="text-muted-foreground">{label}</span>

        return [
            {
                id: "order",
                accessorKey: "orderId",
                header: t("list.columns.order"),
                enableHiding: false,
                size: 200,
                meta: { label: t("list.columns.order"), sortKey: "seq" },
                cell: ({ row }) => {
                    const item = row.original

                    return (
                        <div className="flex min-w-0 flex-col items-start gap-1">
                            <span className="flex items-center gap-1.5">
                                <Mono className="font-medium">{item.orderId}</Mono>
                                {item.flaggedForReview && (
                                    <IconFlag className="text-destructive size-3.5" stroke={1.5} aria-label={t("list.sheet.flagged")} />
                                )}
                                {item.disputeStatus && (
                                    <IconGavel className="text-destructive size-3.5" stroke={1.5} aria-label={t("list.sheet.disputed")} />
                                )}
                            </span>
                            <OrderStatusBadge status={item.status} className="px-1.5 py-0.5 text-xs" />
                            <span className="text-muted-foreground flex max-w-full items-center gap-1 text-xs">
                                <span className="truncate">
                                    {t(`header.filters.category.options.${item.category}`)}
                                    {" · "}
                                    {f.number(Number(item.weight), { maximumFractionDigits: 1 })} {item.weightUnit}
                                </span>
                                {item.isHazardous && <IconAlertTriangle className="size-3.5 shrink-0 text-orange-500" stroke={1.5} aria-label={t("data.flags.hazardous")} />}
                                {item.isRefrigerated && <IconSnowflake className="size-3.5 shrink-0 text-sky-500" stroke={1.5} aria-label={t("data.flags.refrigerated")} />}
                            </span>
                        </div>
                    )
                },
            },
            {
                id: "route",
                header: t("list.columns.route"),
                size: 200,
                meta: { label: t("list.columns.route") },
                cell: ({ row }) => {
                    const item = row.original
                    const facts = [
                        item.distance ? `${f.number(item.distance)} km` : null,
                        t(`list.values.${item.route}`),
                        item.tripType === "backload" ? t("list.values.backload") : null,
                    ].filter(Boolean).join(" · ")

                    return (
                        <StackCell
                            primary={
                                <span className="flex min-w-0 items-center gap-1">
                                    <span className="truncate">{place(item.loadingAddress)}</span>
                                    <IconArrowRight className="text-muted-foreground size-3 shrink-0" stroke={1.5} />
                                    <span className="truncate">{place(item.offloadingAddress)}</span>
                                </span>
                            }
                            secondary={facts}
                        />
                    )
                },
            },
            {
                id: "loading",
                accessorKey: "expectedLoadingDate",
                header: t("list.columns.loading"),
                size: 110,
                meta: { label: t("list.columns.loading"), sortKey: "loading" },
                cell: ({ row }) => {
                    const item = row.original
                    const late = PRE_LOADING_STATUSES.includes(item.status) ? daysLate(item.expectedLoadingDate, today) : 0

                    return (
                        <StackCell
                            primary={<span className="tabular-nums">{day(item.expectedLoadingDate)}</span>}
                            secondary={
                                late > 0
                                    ? <span className="text-destructive">{t("list.values.late", { days: late })}</span>
                                    : item.expectedOffloadingDate
                                        ? <span className="tabular-nums">→ {day(item.expectedOffloadingDate)}</span>
                                        : undefined
                            }
                        />
                    )
                },
            },
            {
                id: "shipper",
                accessorKey: "shipperName",
                header: t("list.columns.shipper"),
                size: 180,
                meta: { label: t("list.columns.shipper") },
                cell: ({ row }) => (
                    <StackCell
                        primary={<span className="truncate">{row.original.shipperName}</span>}
                        secondary={row.original.shipperInvoiceNumber ? <Mono>{row.original.shipperInvoiceNumber}</Mono> : muted(t("list.values.no-invoice"))}
                    />
                ),
            },
            {
                id: "carrier",
                accessorKey: "carrierName",
                header: t("list.columns.carrier"),
                size: 200,
                meta: { label: t("list.columns.carrier") },
                cell: ({ row }) => {
                    const item = row.original
                    const rig = item.driverName || item.truckPlate

                    return (
                        <StackCell
                            primary={item.carrierName ? <span className="truncate">{item.carrierName}</span> : muted(t("list.values.no-carrier"))}
                            secondary={rig ? (
                                <span className="flex min-w-0 items-center gap-1.5">
                                    {item.driverName && <span className="truncate">{item.driverName}</span>}
                                    {item.truckPlate && <PlateChip plate={item.truckPlate} />}
                                </span>
                            ) : muted(t("list.values.no-driver"))}
                        />
                    )
                },
            },
            {
                id: "total",
                accessorKey: "shipperTotal",
                header: t("list.columns.total"),
                size: 130,
                meta: { label: t("list.columns.total"), sortKey: "total", align: "right" },
                cell: ({ row }) => {
                    const item = row.original

                    // Read from Appload's side: the shipper's total comes in
                    // (green), the carrier's goes out (red)
                    return item.shipperTotal === null
                        ? muted(t("list.values.no-total"))
                        : (
                            <StackCell
                                primary={<span className="tabular-nums text-emerald-600 dark:text-emerald-400">{money(item.shipperTotal, item.shipperCurrency)}</span>}
                                secondary={item.carrierTotal !== null
                                    ? <span className="tabular-nums text-destructive">{money(item.carrierTotal, item.carrierCurrency)}</span>
                                    : undefined}
                            />
                        )
                },
            },
            {
                id: "payment",
                header: t("list.columns.payment"),
                size: 150,
                meta: { label: t("list.columns.payment") },
                cell: ({ row }) => (
                    <div className="flex flex-col items-start gap-1">
                        <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground w-3">{t("list.values.shipper-short")}</span>
                            <PaymentStatusChip party="shipper" status={row.original.shipperPaymentStatus} />
                        </span>
                        <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground w-3">{t("list.values.carrier-short")}</span>
                            <PaymentStatusChip party="carrier" status={row.original.carrierPaymentStatus} />
                        </span>
                    </div>
                ),
            },
            {
                id: "actions",
                header: "",
                enableHiding: false,
                size: 72,
                meta: { label: t("list.columns.actions"), align: "right", className: "pr-2" },
                cell: ({ row }) => (
                    <OrderRowActions row={row.original} onOpen={onOpen} onConfirm={onConfirm} onEdit={onEdit} onTransition={onTransition} />
                ),
            },
        ]
    }, [t, f, money, today, onOpen, onConfirm, onEdit, onTransition])
}
