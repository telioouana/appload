"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, IdentityCell, initials, Mono } from "@workspace/ui/customs/list/table-cells"
import type { KpiPartyRow } from "@/frontend/pages/kpis/types"

/**
 * Column definitions for the ranked list of parties. A hook because the
 * headers, the line under each name and every figure need translations and a
 * formatter; memoised so the table instance is not rebuilt on every render.
 *
 * Money is USD whatever the trips were invoiced in — converted at each
 * loading day's rate, which the page header says once for the whole list — so
 * the headers carry the unit and the cells carry only digits. A rate or an
 * average with an empty divisor is a dash, never a misleading zero.
 */
export function usePartyColumns() {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()

    return useMemo<ColumnDef<KpiPartyRow, unknown>[]>(() => {
        const count = (value: number) => <Mono>{f.number(value)}</Mono>

        const decimal = (value: number, digits: number) =>
            <Mono>{f.number(value, { maximumFractionDigits: digits })}</Mono>

        // Fixed digits: a column of prices reads as a column, not as a ladder
        const money = (value: number | null, digits: number) =>
            value === null
                ? <Dash />
                : <Mono>{f.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })}</Mono>

        const percent = (value: number | null) =>
            value === null ? <Dash /> : <Mono>{f.number(value, { style: "percent", maximumFractionDigits: 0 })}</Mono>

        return [
            {
                id: "name",
                accessorKey: "name",
                header: t("landing.columns.name"),
                enableHiding: false,
                size: 260,
                meta: { label: t("landing.columns.name"), sortKey: "name" },
                cell: ({ row }) => (
                    <IdentityCell
                        fallback={initials(row.original.name)}
                        name={row.original.name}
                        sub={t("columns.sub", {
                            deliveries: row.original.deliveries,
                            // A string, or ICU would print the tonnage as a
                            // plain number and undo the rounding
                            tons: f.number(row.original.tons, { maximumFractionDigits: 1 }),
                        })}
                    />
                ),
            },
            {
                id: "transports",
                accessorKey: "transports",
                header: t("landing.columns.transports"),
                size: 110,
                meta: { label: t("landing.columns.transports"), sortKey: "transports", align: "right" },
                cell: ({ row }) => count(row.original.transports),
            },
            {
                id: "onTime",
                accessorKey: "onTimeOffloadingRate",
                header: t("landing.columns.on-time"),
                size: 170,
                meta: { label: t("landing.columns.on-time"), sortKey: "on-time", align: "right" },
                cell: ({ row }) => percent(row.original.onTimeOffloadingRate),
            },
            {
                id: "price",
                accessorKey: "pricePerTransport",
                header: t("landing.columns.price-per-transport"),
                size: 180,
                meta: { label: t("landing.columns.price-per-transport"), sortKey: "price", align: "right" },
                cell: ({ row }) => money(row.original.pricePerTransport, 0),
            },
            {
                id: "costPerKm",
                accessorKey: "costPerKm",
                header: t("landing.columns.cost-per-km"),
                size: 140,
                meta: { label: t("landing.columns.cost-per-km"), sortKey: "cost-per-km", align: "right" },
                cell: ({ row }) => money(row.original.costPerKm, 2),
            },
            {
                id: "deliveries",
                accessorKey: "deliveries",
                header: t("landing.columns.deliveries"),
                size: 110,
                meta: { label: t("landing.columns.deliveries"), sortKey: "deliveries", align: "right" },
                cell: ({ row }) => count(row.original.deliveries),
            },
            {
                id: "tons",
                accessorKey: "tons",
                header: t("landing.columns.tons"),
                size: 90,
                meta: { label: t("landing.columns.tons"), sortKey: "tons", align: "right" },
                cell: ({ row }) => decimal(row.original.tons, 1),
            },
        ]
    }, [t, f])
}
