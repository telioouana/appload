"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Dash, IdentityCell, initials, Mono, PlateChip, ProgressCell, StackCell } from "@workspace/ui/customs/list/table-cells"
import { RowActions } from "@/frontend/pages/partners/sections/row-actions"
import { TripLocation } from "@/frontend/pages/partners/sections/trip-location"
import { daysUntil, KycBadge, OwnershipBadge } from "@/frontend/pages/partners/sections/badges"
import type { VehicleRow } from "@/frontend/pages/partners/types"

export function useVehicleColumns({
    today,
    onOpen,
}: {
    today: string
    onOpen: (row: VehicleRow, tab?: "documents") => void
}) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()

    return useMemo<ColumnDef<VehicleRow, unknown>[]>(() => [
        {
            id: "plate",
            accessorKey: "regPlate",
            header: t("columns.vehicle"),
            enableHiding: false,
            size: 210,
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
            id: "carrier",
            accessorKey: "carrierName",
            header: t("columns.carrier"),
            size: 170,
            meta: { label: t("columns.carrier"), sortKey: "carrier" },
            cell: ({ row }) => <span className="block truncate">{row.original.carrierName ?? <span className="text-muted-foreground">{t("values.none")}</span>}</span>,
        },
        {
            id: "ownership",
            accessorKey: "ownershipStatus",
            header: t("columns.ownership"),
            size: 140,
            meta: { label: t("columns.ownership") },
            cell: ({ row }) => (
                <span title={row.original.ownerName ?? undefined}>
                    <OwnershipBadge status={row.original.ownershipStatus} />
                </span>
            ),
        },
        {
            id: "driver",
            header: t("columns.driver"),
            size: 160,
            meta: { label: t("columns.driver") },
            cell: ({ row }) =>
                row.original.driverName
                    ? <IdentityCell size="sm" fallback={initials(row.original.driverName)} name={row.original.driverName} />
                    : <span className="text-muted-foreground text-xs">{t("values.unassigned")}</span>,
        },
        {
            id: "capacity",
            header: t("columns.capacity"),
            size: 80,
            meta: { label: t("columns.capacity"), align: "right" },
            cell: ({ row }) =>
                row.original.capacity !== null
                    ? <Mono>{t("values.tons", { tons: f.number(row.original.capacity) })}</Mono>
                    : <Dash />,
        },
        {
            id: "location",
            header: t("columns.location"),
            size: 160,
            meta: { label: t("columns.location") },
            cell: ({ row }) => <TripLocation trip={row.original.trip} />,
        },
        {
            id: "status",
            accessorKey: "kycStatus",
            header: t("columns.status"),
            size: 130,
            meta: { label: t("columns.status"), sortKey: "status" },
            cell: ({ row }) => <KycBadge status={row.original.kycStatus} />,
        },
        {
            id: "documents",
            header: t("columns.documents"),
            size: 130,
            meta: { label: t("columns.documents") },
            cell: ({ row }) => {
                const days = row.original.nextExpiry ? daysUntil(row.original.nextExpiry, today) : null
                const hint = days === null || days > 30 ? undefined : days < 0 ? t("values.expired") : t("values.expires-in", { days })

                return (
                    <ProgressCell
                        approved={row.original.progress.approved}
                        required={row.original.progress.required}
                        hint={hint}
                        tone={days !== null && days < 0 ? "danger" : "warn"}
                    />
                )
            },
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
                    onOpen={() => onOpen(row.original)}
                    onReview={() => onOpen(row.original, "documents")}
                    copy={[{ label: t("actions.copy-plate"), value: row.original.regPlate }]}
                />
            ),
        },
    ], [today, t, f, onOpen])
}
