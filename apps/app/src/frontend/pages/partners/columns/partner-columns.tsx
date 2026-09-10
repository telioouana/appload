"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, IdentityCell, initials, Mono } from "@/components/list/table-cells"
import { PartnerRowActions } from "@/frontend/pages/partners/sections/row-actions"
import { DirectionChip, KycBadge, RelationChip } from "@/frontend/pages/partners/sections/badges"
import type { OrgType, PartnerRow } from "@/frontend/pages/partners/types"

/**
 * Columns for the partners table. A hook because the cells need translations
 * and a formatter; memoised so the table instance is not rebuilt — and every
 * cell remounted — on each render.
 */
export function usePartnerColumns({
    orgType,
    onOpen,
}: {
    orgType: OrgType
    onOpen: (row: PartnerRow) => void
}) {
    const t = useTranslations("App.partners")
    const f = useFormatter()

    return useMemo<ColumnDef<PartnerRow, unknown>[]>(() => [
        {
            id: "partner",
            accessorKey: "partner.name",
            header: t("columns.partner"),
            enableHiding: false,
            size: 260,
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
            id: "relation",
            header: t("columns.relation"),
            size: 190,
            meta: { label: t("columns.relation") },
            cell: ({ row }) => (
                <div className="flex flex-wrap items-center gap-1.5">
                    <RelationChip relation={row.original.relation} orgType={orgType} />
                    {row.original.status === "pending" && <DirectionChip direction={row.original.direction} />}
                </div>
            ),
        },
        {
            id: "kyc",
            header: t("columns.kyc"),
            size: 150,
            meta: { label: t("columns.kyc") },
            cell: ({ row }) => <KycBadge status={row.original.partner.kycStatus} />,
        },
        {
            id: "orders",
            accessorKey: "sharedOrders",
            header: t("columns.orders"),
            size: 110,
            meta: { label: t("columns.orders"), sortKey: "orders", align: "right" },
            cell: ({ row }) =>
                row.original.sharedOrders === 0 ? <Dash /> : <Mono>{row.original.sharedOrders}</Mono>,
        },
        {
            id: "since",
            header: t("columns.since"),
            size: 140,
            meta: { label: t("columns.since"), sortKey: "since" },
            cell: ({ row }) => (
                <span className="text-muted-foreground text-[13px]">
                    {f.dateTime(row.original.respondedAt ?? row.original.createdAt, { dateStyle: "medium" })}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            size: 56,
            enableHiding: false,
            meta: { label: t("columns.actions"), align: "right" },
            cell: ({ row }) => <PartnerRowActions row={row.original} onOpen={() => onOpen(row.original)} />,
        },
    ], [t, f, orgType, onOpen])
}
