"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { useTranslations } from "@workspace/i18n"

import { CopyableText, IdentityCell, initials, Mono, PlateChip, ProgressCell } from "@/components/list/table-cells"
import { RowActions } from "@/frontend/pages/partners/sections/row-actions"
import { MissingField } from "@/frontend/pages/partners/sections/missing-field"
import { WhatsappMark } from "@/frontend/pages/partners/sections/whatsapp-mark"
import { TripLocation } from "@/frontend/pages/partners/sections/trip-location"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { daysUntil, KycBadge } from "@/frontend/pages/partners/sections/badges"
import { isPlaceholder, type DriverRow } from "@/frontend/pages/partners/types"

export function useDriverColumns({
    today,
    onOpen,
}: {
    today: string
    onOpen: (row: DriverRow, tab?: "documents") => void
}) {
    const t = useTranslations("Admin.partners")
    // Only the stable mutate function goes into the memo (see organization-columns)
    const { mutateAsync: saveDriver } = usePartnerMutations().updateDriver

    return useMemo<ColumnDef<DriverRow, unknown>[]>(() => {
        const patch = (row: DriverRow, field: "phoneNumber" | "passport") => (value: string) =>
            saveDriver({ id: row.id, patch: { [field]: value } })

        return [
            {
                id: "name",
                accessorKey: "name",
                header: t("columns.driver"),
                enableHiding: false,
                size: 220,
                meta: { label: t("columns.driver"), sortKey: "name" },
                cell: ({ row }) => (
                    <IdentityCell
                        image={row.original.image}
                        fallback={initials(row.original.name)}
                        name={row.original.name}
                        sub={row.original.passport
                            ? t("values.passport", { number: row.original.passport })
                            : <MissingField kind="passport" label={t("missing.add.passport")} onSave={patch(row.original, "passport")} />}
                    />
                ),
            },
            {
                id: "phone",
                header: t("columns.phone"),
                size: 160,
                meta: { label: t("columns.phone") },
                cell: ({ row }) =>
                    isPlaceholder("phone", row.original.phoneNumber)
                        ? <MissingField kind="phone" label={t("missing.add.phone")} onSave={patch(row.original, "phoneNumber")} />
                        : (
                            <span className="flex items-center gap-1.5">
                                <CopyableText value={row.original.phoneNumber!} label={t("actions.copy-phone")}>
                                    <Mono>{row.original.phoneNumber}</Mono>
                                </CopyableText>
                                <WhatsappMark status={row.original.whatsapp} phone={row.original.phoneNumber!} />
                            </span>
                        ),
            },
            {
                id: "carrier",
                accessorKey: "carrierName",
                header: t("columns.carrier"),
                size: 180,
                meta: { label: t("columns.carrier"), sortKey: "carrier" },
                cell: ({ row }) => <span className="block truncate">{row.original.carrierName ?? <span className="text-muted-foreground">{t("values.none")}</span>}</span>,
            },
            {
                id: "truck",
                header: t("columns.truck"),
                size: 120,
                meta: { label: t("columns.truck") },
                cell: ({ row }) =>
                    row.original.plate
                        ? <PlateChip plate={row.original.plate} />
                        : <span className="text-muted-foreground text-xs">{t("values.unassigned")}</span>,
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
                header: t("columns.licence"),
                size: 140,
                meta: { label: t("columns.licence") },
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
                id: "actions",
                header: "",
                enableHiding: false,
                size: 48,
                meta: { label: t("columns.actions"), align: "right", className: "pr-2" },
                cell: ({ row }) => (
                    <RowActions
                        onOpen={() => onOpen(row.original)}
                        onReview={() => onOpen(row.original, "documents")}
                        copy={row.original.phoneNumber && !isPlaceholder("phone", row.original.phoneNumber)
                            ? [{ label: t("actions.copy-phone"), value: row.original.phoneNumber }]
                            : []}
                    />
                ),
            },
        ]
    }, [today, t, onOpen, saveDriver])
}
