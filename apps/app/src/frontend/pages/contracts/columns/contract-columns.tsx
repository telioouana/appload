"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { IdentityCell, initials, Mono } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { LaneCell } from "@/frontend/pages/quotes/sections/badges"
import { ContractRoleChip, ContractStateChip, ProgressBar, unitOf, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import type { ContractRow } from "@/frontend/pages/contracts/types"

/** The period bounds are stored as "YYYY-MM-DD": read as a local day, never shifted by the zone. */
const localDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/**
 * Columns for the contracts table. A hook because the cells need translations
 * and a formatter; memoised so the table instance is not rebuilt — and every
 * cell remounted — on each render.
 */
export function useContractColumns() {
    const t = useTranslations("App.contracts")
    const f = useFormatter()
    const unitLabel = useUnitLabel()

    return useMemo<ColumnDef<ContractRow, unknown>[]>(() => [
        {
            id: "reference",
            accessorKey: "ref",
            header: t("columns.reference"),
            enableHiding: false,
            size: 170,
            meta: { label: t("columns.reference"), sortKey: "reference" },
            cell: ({ row }) => (
                <div className="flex min-w-0 flex-col gap-0.5">
                    <Mono>{row.original.ref}</Mono>
                    <span className="text-muted-foreground truncate text-xs">{t(`basis.${row.original.basis}`)}</span>
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
                if (role !== "owner") {
                    return <IdentityCell fallback={initials(owner.name)} name={owner.name} sub={<ContractRoleChip role={role} />} />
                }

                if (!client) return <EmptyValue label={t("values.own-account")} />

                const name = client.name ?? t("values.no-client")

                return <IdentityCell fallback={initials(name)} name={name} sub={client.id ? undefined : t("values.typed")} />
            },
        },
        {
            id: "lane",
            header: t("columns.lane"),
            size: 260,
            meta: { label: t("columns.lane") },
            cell: ({ row }) =>
                row.original.origin && row.original.destination
                    ? <LaneCell origin={row.original.origin} destination={row.original.destination} />
                    : <EmptyValue label={t("values.any-lane")} />,
        },
        {
            id: "period",
            header: t("columns.period"),
            size: 200,
            meta: { label: t("columns.period"), sortKey: "period" },
            cell: ({ row }) => (
                <span className="text-[13px] whitespace-nowrap">
                    {f.dateTime(localDate(row.original.startsOn), { dateStyle: "medium" })}
                    {" – "}
                    {f.dateTime(localDate(row.original.endsOn), { dateStyle: "medium" })}
                </span>
            ),
        },
        {
            id: "commitment",
            header: t("columns.commitment"),
            size: 130,
            meta: { label: t("columns.commitment") },
            cell: ({ row }) => (
                <span className="text-[13px] tabular-nums">
                    {unitLabel(unitOf(row.original.basis), row.original.committedQty)}
                </span>
            ),
        },
        {
            id: "progress",
            header: t("columns.progress"),
            size: 180,
            meta: { label: t("columns.progress") },
            cell: ({ row }) => {
                const unit = unitOf(row.original.basis)
                const { consumed, remaining } = row.original.progress

                return (
                    <div className="flex min-w-0 flex-col gap-1">
                        <ProgressBar consumed={consumed} total={row.original.committedQty} unit={unit} />
                        <span className="text-muted-foreground truncate text-xs">
                            {t("values.remaining", { qty: unitLabel(unit, Math.max(0, remaining)) })}
                        </span>
                    </div>
                )
            },
        },
        {
            id: "state",
            header: t("columns.state"),
            enableHiding: false,
            size: 120,
            meta: { label: t("columns.state") },
            cell: ({ row }) => <ContractStateChip state={row.original.state} />,
        },
    ], [t, f, unitLabel])
}
