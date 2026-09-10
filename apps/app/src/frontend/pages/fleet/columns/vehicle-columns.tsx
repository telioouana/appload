"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, IdentityCell, initials, Mono, PlateChip, ProgressCell, StackCell } from "@/components/list/table-cells"
import { RowActions } from "@/frontend/pages/fleet/sections/row-actions"
import { KycBadge, OwnershipBadge, StateBadge } from "@/frontend/pages/fleet/sections/badges"
import type { VehicleKind, VehicleRow } from "@/frontend/pages/fleet/types"

export function useVehicleColumns({
    kind,
    onOpen,
}: {
    kind: VehicleKind
    onOpen: (row: VehicleRow) => void
}) {
    const t = useTranslations("App.fleet")
    // The body labels already exist for the registration form; reuse them
    const bays = useTranslations("App.fleet.register.fields.bay.type.options")
    const f = useFormatter()

    return useMemo<ColumnDef<VehicleRow, unknown>[]>(() => [
        {
            id: "plate",
            accessorKey: "regPlate",
            header: t("columns.vehicle"),
            enableHiding: false,
            size: 220,
            meta: { label: t("columns.vehicle"), sortKey: "plate" },
            cell: ({ row }) => (
                <StackCell
                    primary={<PlateChip plate={row.original.regPlate} />}
                    secondary={[
                        `${row.original.brand} ${row.original.model}`,
                        row.original.year,
                        row.original.truckType ? t(`values.truck-type.${row.original.truckType}`) : null,
                    ].filter(Boolean).join(" · ")}
                />
            ),
        },
        {
            id: "bay",
            header: t("columns.bay"),
            size: 170,
            meta: { label: t("columns.bay") },
            cell: ({ row }) =>
                row.original.bayType
                    ? (
                        <StackCell
                            primary={bays(row.original.bayType)}
                            secondary={row.original.capacity !== null
                                ? t("values.tons", { tons: f.number(row.original.capacity) })
                                : null}
                        />
                    )
                    : <Dash />,
        },
        kind === "truck"
            ? {
                id: "driver",
                header: t("columns.driver"),
                size: 170,
                meta: { label: t("columns.driver") },
                cell: ({ row }) =>
                    row.original.driverName
                        ? <IdentityCell size="sm" fallback={initials(row.original.driverName)} name={row.original.driverName} />
                        : <span className="text-muted-foreground text-xs">{t("values.unassigned")}</span>,
            }
            : {
                id: "hitched",
                header: t("columns.hitched"),
                size: 150,
                meta: { label: t("columns.hitched") },
                cell: ({ row }) =>
                    row.original.hitchedTo
                        ? <PlateChip plate={row.original.hitchedTo} />
                        : <span className="text-muted-foreground text-xs">{t("values.not-hitched")}</span>,
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
            id: "ownership",
            accessorKey: "ownershipStatus",
            header: t("columns.ownership"),
            size: 150,
            meta: { label: t("columns.ownership") },
            cell: ({ row }) => (
                <span title={row.original.ownerName ?? undefined}>
                    <OwnershipBadge status={row.original.ownershipStatus} />
                </span>
            ),
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
            id: "year",
            accessorKey: "year",
            header: t("columns.year"),
            size: 70,
            meta: { label: t("columns.year"), sortKey: "year", align: "right" },
            cell: ({ row }) => <Mono>{row.original.year}</Mono>,
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
                    copy={[{ label: t("actions.copy-plate"), value: row.original.regPlate }]}
                />
            ),
        },
    ], [kind, t, bays, f, onOpen])
}
