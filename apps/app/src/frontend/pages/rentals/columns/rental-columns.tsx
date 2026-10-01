"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { IdentityCell, initials, Mono } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import { AttentionChips, RentalRoleChip, RentalStateChip } from "@/frontend/pages/rentals/sections/badges"
import type { RentalRow } from "@/frontend/pages/rentals/types"

/** The period bounds are stored as "YYYY-MM-DD": read as a local day, never shifted by the zone. */
const localDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/**
 * Columns for the rentals table. A hook because the cells need translations
 * and a formatter; memoised so the table instance is not rebuilt — and every
 * cell remounted — on each render.
 */
export function useRentalColumns() {
    const t = useTranslations("App.rentals")
    const f = useFormatter()
    const money = useMoney()

    return useMemo<ColumnDef<RentalRow, unknown>[]>(() => {
        const day = (value: string) => f.dateTime(localDate(value), { dateStyle: "medium" })

        return [
            {
                id: "reference",
                accessorKey: "ref",
                header: t("columns.reference"),
                enableHiding: false,
                size: 170,
                meta: { label: t("columns.reference"), sortKey: "reference" },
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <Mono>{row.original.ref}</Mono>
                        {row.original.role !== "owner" && <RentalRoleChip role={row.original.role} />}
                    </div>
                ),
            },
            {
                id: "counterparty",
                header: t("columns.counterparty"),
                enableHiding: false,
                size: 220,
                meta: { label: t("columns.counterparty") },
                cell: ({ row }) => {
                    const { role, owner, client } = row.original

                    // The owner reads who it is for; everybody else reads whose it is
                    if (role !== "owner") return <IdentityCell fallback={initials(owner.name)} name={owner.name} />

                    if (!client) return <EmptyValue label={t("values.own-account")} />

                    const name = client.name ?? t("values.no-client")

                    return <IdentityCell fallback={initials(name)} name={name} sub={client.id ? undefined : t("values.typed")} />
                },
            },
            {
                id: "trucks",
                header: t("columns.trucks"),
                size: 220,
                meta: { label: t("columns.trucks") },
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px]">{t("values.trucks", { count: row.original.trucks.length })}</span>
                        <span className="text-muted-foreground truncate text-xs">{row.original.trucks.join(" · ")}</span>
                    </div>
                ),
            },
            {
                id: "period",
                header: t("columns.period"),
                size: 200,
                meta: { label: t("columns.period"), sortKey: "period" },
                cell: ({ row }) => (
                    <span className="text-[13px] whitespace-nowrap">
                        {row.original.endsOn === null
                            ? t("values.since", { date: day(row.original.startsOn) })
                            : `${day(row.original.startsOn)} – ${day(row.original.endsOn)}`}
                    </span>
                ),
            },
            {
                id: "days",
                header: t("columns.days"),
                size: 140,
                meta: { label: t("columns.days") },
                cell: ({ row }) => (
                    <span className="text-[13px] tabular-nums">
                        {row.original.periodDays === null
                            ? t("values.days-open", { billable: row.original.billableDays })
                            : t("values.days-of", { billable: row.original.billableDays, total: row.original.periodDays })}
                    </span>
                ),
            },
            {
                id: "billable",
                header: t("columns.billable"),
                size: 140,
                meta: { label: t("columns.billable") },
                cell: ({ row }) => <span className="text-[13px] tabular-nums">{money(row.original.billable, row.original.currency)}</span>,
            },
            {
                id: "state",
                header: t("columns.state"),
                enableHiding: false,
                size: 160,
                meta: { label: t("columns.state") },
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col items-start gap-1">
                        <RentalStateChip state={row.original.state} />
                        <AttentionChips attention={row.original.attention} />
                    </div>
                ),
            },
        ]
    }, [t, f, money])
}
