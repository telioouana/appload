"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, IdentityCell, initials, Mono } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { CoverChips, LaneCell, QuoteStatusChip, useMoney } from "@/frontend/pages/quotes/sections/badges"
import type { QuoteRow } from "@/frontend/pages/quotes/types"

/**
 * Columns for the quotes table. A hook because the cells need translations
 * and a formatter; memoised so the table instance is not rebuilt — and every
 * cell remounted — on each render.
 */
export function useQuoteColumns() {
    const t = useTranslations("App.quotes")
    const f = useFormatter()
    const money = useMoney()

    return useMemo<ColumnDef<QuoteRow, unknown>[]>(() => [
        {
            id: "partner",
            accessorKey: "partner.name",
            header: t("columns.partner"),
            enableHiding: false,
            size: 220,
            meta: { label: t("columns.partner"), sortKey: "partner" },
            cell: ({ row }) => (
                <IdentityCell
                    fallback={initials(row.original.partner.name)}
                    name={row.original.partner.name}
                    sub={row.original.partner.province ?? undefined}
                />
            ),
        },
        {
            id: "lane",
            header: t("columns.lane"),
            size: 260,
            meta: { label: t("columns.lane") },
            cell: ({ row }) => <LaneCell origin={row.original.origin} destination={row.original.destination} />,
        },
        {
            id: "loading",
            header: t("columns.loading"),
            size: 130,
            meta: { label: t("columns.loading") },
            cell: ({ row }) =>
                row.original.loadingDate === null ? (
                    <EmptyValue label={t("values.open-date")} />
                ) : (
                    <span className="text-[13px]">
                        {f.dateTime(row.original.loadingDate, { dateStyle: "medium" })}
                    </span>
                ),
        },
        {
            id: "capacity",
            header: t("columns.capacity"),
            size: 160,
            meta: { label: t("columns.capacity") },
            cell: ({ row }) => {
                const { capacityWeight, capacityUnit, loadingBay } = row.original

                const weight = capacityWeight !== null && capacityUnit !== null
                    ? `${f.number(capacityWeight, { maximumFractionDigits: 2 })} ${t(`unit.${capacityUnit}`)}`
                    : null
                const bay = loadingBay ? t(`bay.${loadingBay}`) : null

                if (!weight && !bay) return <Dash />

                return (
                    <div className="flex min-w-0 flex-col gap-0.5">
                        {weight && <span className="truncate text-[13px] tabular-nums">{weight}</span>}
                        {bay && <span className="text-muted-foreground truncate text-xs">{bay}</span>}
                    </div>
                )
            },
        },
        {
            id: "total",
            accessorKey: "money.total",
            header: t("columns.total"),
            size: 150,
            meta: { label: t("columns.total"), sortKey: "total", align: "right" },
            cell: ({ row }) => <Mono>{money(row.original.money.total, row.original.money.currency)}</Mono>,
        },
        {
            id: "cover",
            header: t("columns.cover"),
            size: 150,
            meta: { label: t("columns.cover") },
            cell: ({ row }) => (
                <CoverChips includesGit={row.original.includesGit} includesGps={row.original.includesGps} />
            ),
        },
        {
            id: "valid",
            header: t("columns.valid"),
            size: 140,
            meta: { label: t("columns.valid"), sortKey: "valid" },
            cell: ({ row }) =>
                row.original.validUntil === null ? (
                    <EmptyValue label={t("values.no-expiry")} />
                ) : (
                    <span className="text-muted-foreground text-[13px]">
                        {f.dateTime(row.original.validUntil, { dateStyle: "medium" })}
                    </span>
                ),
        },
        {
            id: "status",
            header: t("columns.status"),
            enableHiding: false,
            size: 130,
            meta: { label: t("columns.status") },
            cell: ({ row }) => <QuoteStatusChip status={row.original.status} />,
        },
    ], [t, f, money])
}
