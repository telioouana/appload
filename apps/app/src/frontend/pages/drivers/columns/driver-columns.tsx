"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useTranslations } from "@workspace/i18n"

import { CopyableText, IdentityCell, initials, Mono, PlateChip, ProgressCell } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { RowActions } from "@/frontend/pages/fleet/sections/row-actions"
import { KycBadge, StateBadge } from "@/frontend/pages/fleet/sections/badges"
import { isPlaceholderEmail, type DriverRow } from "@/frontend/pages/drivers/types"

export function useDriverColumns({ onOpen }: { onOpen: (row: DriverRow) => void }) {
    const t = useTranslations("App.drivers")

    return useMemo<ColumnDef<DriverRow, unknown>[]>(() => [
        {
            id: "name",
            accessorKey: "name",
            header: t("columns.driver"),
            enableHiding: false,
            size: 230,
            meta: { label: t("columns.driver"), sortKey: "name" },
            cell: ({ row }) => (
                <IdentityCell
                    image={row.original.image}
                    fallback={initials(row.original.name)}
                    name={row.original.name}
                    sub={row.original.passport
                        ? t("values.passport", { number: row.original.passport })
                        : undefined}
                />
            ),
        },
        {
            id: "phone",
            header: t("columns.phone"),
            size: 160,
            meta: { label: t("columns.phone") },
            cell: ({ row }) =>
                row.original.phoneNumber
                    ? (
                        <CopyableText value={row.original.phoneNumber} label={t("actions.copy-phone")}>
                            <Mono>{row.original.phoneNumber}</Mono>
                        </CopyableText>
                    )
                    : <EmptyValue label={t("values.none")} />,
        },
        {
            id: "email",
            header: t("columns.email"),
            size: 210,
            meta: { label: t("columns.email") },
            // A driver registered without one carries a stand-in address;
            // showing it would invite someone to write to a dead mailbox
            cell: ({ row }) =>
                isPlaceholderEmail(row.original.email)
                    ? <EmptyValue label={t("values.no-email")} />
                    : (
                        <CopyableText value={row.original.email} label={t("actions.copy-email")}>
                            {row.original.email}
                        </CopyableText>
                    ),
        },
        {
            id: "truck",
            header: t("columns.truck"),
            size: 130,
            meta: { label: t("columns.truck") },
            cell: ({ row }) =>
                row.original.plate
                    ? <PlateChip plate={row.original.plate} />
                    : <span className="text-muted-foreground text-xs">{t("values.unassigned")}</span>,
        },
        {
            id: "state",
            accessorKey: "status",
            header: t("columns.state"),
            size: 130,
            meta: { label: t("columns.state") },
            cell: ({ row }) => <StateBadge state={row.original.status} />,
        },
        {
            id: "status",
            accessorKey: "kycStatus",
            header: t("columns.status"),
            size: 140,
            meta: { label: t("columns.status"), sortKey: "status" },
            cell: ({ row }) => <KycBadge status={row.original.kycStatus} />,
        },
        {
            id: "documents",
            header: t("columns.documents"),
            size: 120,
            meta: { label: t("columns.documents") },
            cell: ({ row }) => (
                <ProgressCell approved={row.original.progress.approved} required={row.original.progress.required} />
            ),
        },
        {
            id: "actions",
            header: "",
            enableHiding: false,
            size: 48,
            meta: { label: t("columns.actions"), align: "right", className: "pr-2" },
            cell: ({ row }) => (
                <RowActions
                    labels={{ menu: t("actions.menu"), open: t("actions.open") }}
                    onOpen={() => onOpen(row.original)}
                    copy={row.original.phoneNumber
                        ? [{ label: t("actions.copy-phone"), value: row.original.phoneNumber }]
                        : []}
                />
            ),
        },
    ], [t, onOpen])
}
