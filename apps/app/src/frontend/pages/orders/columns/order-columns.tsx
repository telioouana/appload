"use client"

import { useMemo } from "react"
import { IconArrowRight } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { Dash, Mono, PlateChip, StackCell } from "@/components/list/table-cells"
import { money, place } from "@/frontend/pages/orders/lib/format"
import { OfferStatusBadge, OrderStatusBadge, RequestStatusChip } from "@/frontend/pages/orders/components/badges"
import type { OrderRow, OrgType } from "@/frontend/pages/orders/types"

/**
 * The table's columns. Both organization types read the same table — the
 * difference is what the money and the "answers" columns hold: a shipper
 * sees its own price and how its request round is going, a carrier sees its
 * own quote and what became of the request it was sent. Neither ever
 * receives the other's leg, so neither column can show it.
 */
export function useOrderColumns({ orgType }: { orgType: OrgType }) {
    const t = useTranslations("App.orders")
    const f = useFormatter()

    return useMemo<ColumnDef<OrderRow, unknown>[]>(() => [
        {
            id: "order",
            accessorKey: "orderId",
            header: t("columns.order"),
            enableHiding: false,
            size: 150,
            meta: { label: t("columns.order"), sortKey: "newest" },
            cell: ({ row }) => (
                <StackCell
                    primary={<Mono>{row.original.orderId}</Mono>}
                    secondary={f.dateTime(row.original.createdAt, { dateStyle: "medium" })}
                />
            ),
        },
        {
            id: "status",
            accessorKey: "status",
            header: t("columns.status"),
            size: 190,
            meta: { label: t("columns.status"), sortKey: "status" },
            cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
        },
        {
            id: "route",
            header: t("columns.route"),
            size: 230,
            meta: { label: t("columns.route") },
            cell: ({ row }) => (
                <StackCell
                    primary={
                        <span className="flex items-center gap-1.5">
                            <span className="truncate">{place(row.original.loadingAddress)}</span>
                            <IconArrowRight className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
                            <span className="truncate">{place(row.original.offloadingAddress)}</span>
                        </span>
                    }
                    secondary={[t(`routeType.${row.original.route}`), t(`tripType.${row.original.tripType}`)].join(" · ")}
                />
            ),
        },
        {
            id: "dates",
            accessorKey: "expectedLoadingDate",
            header: t("columns.dates"),
            size: 170,
            meta: { label: t("columns.dates"), sortKey: "loading" },
            cell: ({ row }) => (
                <StackCell
                    primary={f.dateTime(row.original.expectedLoadingDate, { dateStyle: "medium" })}
                    secondary={row.original.expectedOffloadingDate
                        ? t("values.until", { date: f.dateTime(row.original.expectedOffloadingDate, { dateStyle: "medium" }) })
                        : null}
                />
            ),
        },
        {
            id: "counterparty",
            header: t(`columns.counterparty.${orgType}`),
            size: 180,
            meta: { label: t(`columns.counterparty.${orgType}`) },
            cell: ({ row }) => row.original.counterparty.name
                ? <span className="truncate">{row.original.counterparty.name}</span>
                : <span className="text-muted-foreground text-xs">{t(`values.no-counterparty.${orgType}`)}</span>,
        },
        {
            id: "cargo",
            header: t("columns.cargo"),
            size: 200,
            meta: { label: t("columns.cargo") },
            cell: ({ row }) => (
                <StackCell
                    primary={t(`category.${row.original.category}`)}
                    secondary={[
                        `${f.number(row.original.weight, { maximumFractionDigits: 1 })} ${t(`weightUnit.${row.original.weightUnit}`)}`,
                        t(`loadType.${row.original.loadType}`),
                    ].join(" · ")}
                />
            ),
        },
        {
            id: "money",
            header: t("columns.money"),
            size: 150,
            meta: { label: t("columns.money"), align: "right" },
            cell: ({ row }) => {
                const amount = money(f, row.original.money.total, row.original.money.currency)

                return (
                    <span className="block text-right tabular-nums">
                        {amount ?? <Dash />}
                    </span>
                )
            },
        },
        {
            id: "answers",
            header: t("columns.answers"),
            size: 190,
            meta: { label: t("columns.answers") },
            cell: ({ row }) => <Answers row={row.original} orgType={orgType} />,
        },
        {
            id: "dispatch",
            header: t("columns.dispatch"),
            size: 180,
            meta: { label: t("columns.dispatch") },
            cell: ({ row }) => {
                const dispatch = row.original.dispatch

                if (!dispatch) return <Dash />

                return (
                    <StackCell
                        primary={dispatch.driverName ?? <span className="text-muted-foreground text-xs">{t("values.no-driver")}</span>}
                        secondary={dispatch.truckPlate
                            ? <PlateChip plate={dispatch.truckPlate} />
                            : null}
                    />
                )
            },
        },
    ], [t, f, orgType])
}

/**
 * How far the request round got, from the reader's own side: the shipper
 * counts who it asked and who answered, the carrier sees only what became of
 * its own request and its own quote.
 */
function Answers({ row, orgType }: { row: OrderRow; orgType: OrgType }) {
    const t = useTranslations("App.orders")
    const f = useFormatter()

    if (orgType === "carrier") {
        if (row.myOffer) {
            return (
                <div className="flex min-w-0 flex-col gap-1">
                    <OfferStatusBadge status={row.myOffer.status} />
                    <span className="text-muted-foreground truncate text-xs tabular-nums">
                        {money(f, row.myOffer.total, row.myOffer.currency)}
                    </span>
                </div>
            )
        }

        return row.requestState.mine
            ? <RequestStatusChip status={row.requestState.mine} />
            : <Dash />
    }

    const requested = row.requestState.requested ?? 0
    const quoted = row.requestState.quoted ?? 0
    const pending = row.offersPending ?? 0

    if (requested === 0 && quoted === 0 && pending === 0) return <Dash />

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="text-muted-foreground text-xs tabular-nums">
                {t("values.asked", { count: requested + quoted })}
            </span>
            {pending > 0 && (
                <Badge variant="outline" className="border-primary/40 text-primary rounded-full font-normal tabular-nums">
                    {t("values.offers-pending", { count: pending })}
                </Badge>
            )}
        </div>
    )
}
