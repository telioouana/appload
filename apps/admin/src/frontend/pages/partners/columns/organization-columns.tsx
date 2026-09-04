"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { IconMail, IconPhone } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { CopyableText, Dash, IdentityCell, initials, Mono, ProgressCell, StackCell } from "@/components/list/table-cells"
import { RowActions } from "@/frontend/pages/partners/sections/row-actions"
import { MissingField } from "@/frontend/pages/partners/sections/missing-field"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { ContractChip, daysUntil, KycBadge, RiskBadge } from "@/frontend/pages/partners/sections/badges"
import { isPlaceholder, type OrgRow } from "@/frontend/pages/partners/types"

/**
 * Column definitions for the shippers and carriers tables. A hook because
 * the cells need translations, formatters and the edit mutation; memoised
 * so the table instance is not rebuilt on every render.
 */
export function useOrganizationColumns({
    type,
    today,
    onOpen,
}: {
    type: "shipper" | "carrier"
    today: string
    onOpen: (row: OrgRow, tab?: "documents") => void
}) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()
    // Only the stable mutate function goes into the memo: the mutation
    // object changes while a save is pending, and rebuilding the columns
    // then would remount every cell — closing the popover mid-save
    const { mutateAsync: saveOrganization } = usePartnerMutations().updateOrganization

    return useMemo<ColumnDef<OrgRow, unknown>[]>(() => {
        const isCarrier = type === "carrier"

        const percent = (value: number | null) =>
            value === null ? <Dash /> : <Mono>{f.number(value, { style: "percent", maximumFractionDigits: 0 })}</Mono>

        const patch = (row: OrgRow, field: "nuit" | "email" | "phone") => (value: string) =>
            saveOrganization({ id: row.id, patch: { [field]: value } })

        const columns: ColumnDef<OrgRow, unknown>[] = [
            {
                id: "name",
                accessorKey: "name",
                header: t("columns.company"),
                enableHiding: false,
                size: 230,
                meta: { label: t("columns.company"), sortKey: "name" },
                cell: ({ row }) => (
                    <IdentityCell
                        image={row.original.logo}
                        fallback={initials(row.original.name)}
                        name={row.original.name}
                        sub={row.original.city ?? undefined}
                    />
                ),
            },
            {
                id: "nuit",
                accessorKey: "nuit",
                header: t("columns.nuit"),
                size: 120,
                meta: { label: t("columns.nuit") },
                cell: ({ row }) =>
                    isPlaceholder("nuit", row.original.nuit)
                        ? <MissingField kind="nuit" label={t("missing.add.nuit")} onSave={patch(row.original, "nuit")} />
                        : <CopyableText value={row.original.nuit} label={t("actions.copy-nuit")}><Mono>{row.original.nuit}</Mono></CopyableText>,
            },
            {
                id: "contact",
                header: t("columns.contact"),
                size: 220,
                meta: { label: t("columns.contact") },
                cell: ({ row }) => (
                    <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                            <IconPhone className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
                            {isPlaceholder("phone", row.original.phoneNumber)
                                ? <MissingField kind="phone" label={t("missing.add.phone")} onSave={patch(row.original, "phone")} />
                                : <CopyableText value={row.original.phoneNumber} label={t("actions.copy-phone")}><Mono>{row.original.phoneNumber}</Mono></CopyableText>}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <IconMail className="size-3.5 shrink-0" stroke={1.5} />
                            {isPlaceholder("email", row.original.email)
                                ? <MissingField kind="email" label={t("missing.add.email")} onSave={patch(row.original, "email")} />
                                : <CopyableText value={row.original.email} label={t("actions.copy-email")}>{row.original.email}</CopyableText>}
                        </span>
                    </div>
                ),
            },
            {
                id: "status",
                accessorKey: "kycStatus",
                header: t("columns.verification"),
                size: 150,
                meta: { label: t("columns.verification"), sortKey: "status" },
                cell: ({ row }) => (
                    <div className="flex flex-col items-start gap-1">
                        <KycBadge status={row.original.kycStatus} />
                        {row.original.contract && <ContractChip state={row.original.contract} />}
                        <RiskBadge level={row.original.riskLevel} reason={row.original.riskReason} />
                    </div>
                ),
            },
            {
                id: "documents",
                header: t("columns.documents"),
                size: 150,
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
        ]

        if (isCarrier) {
            columns.push({
                id: "fleet",
                header: t("columns.fleet"),
                size: 110,
                meta: { label: t("columns.fleet") },
                cell: ({ row }) => (
                    <StackCell
                        primary={t("values.trucks", { count: row.original.fleetSize })}
                        secondary={t("values.drivers", { count: row.original.driverCount })}
                    />
                ),
            })
        }

        columns.push({
            id: "orders",
            header: t("columns.orders"),
            size: 100,
            meta: { label: t("columns.orders"), sortKey: "orders" },
            cell: ({ row }) =>
                row.original.totalOrders === 0
                    ? <span className="text-muted-foreground">{t("values.none-yet")}</span>
                    : <StackCell
                        primary={t("values.active", { count: row.original.activeOrders })}
                        secondary={t("values.total", { count: row.original.totalOrders })}
                    />,
        })

        columns.push(
            isCarrier
                ? {
                    id: "onTime",
                    header: t("columns.on-time"),
                    size: 80,
                    meta: { label: t("columns.on-time"), align: "right" },
                    cell: ({ row }) => percent(row.original.onTimeRate),
                }
                : {
                    id: "payment",
                    header: t("columns.payment"),
                    size: 90,
                    meta: { label: t("columns.payment"), align: "right" },
                    cell: ({ row }) => percent(row.original.settledRate),
                },
        )

        columns.push({
            id: "actions",
            header: "",
            enableHiding: false,
            size: 48,
            meta: { label: t("columns.actions"), align: "right", className: "pr-2" },
            cell: ({ row }) => (
                <RowActions
                    onOpen={() => onOpen(row.original)}
                    onReview={() => onOpen(row.original, "documents")}
                    copy={[{ label: t("actions.copy-nuit"), value: row.original.nuit }]}
                />
            ),
        })

        return columns
    }, [type, today, t, f, onOpen, saveOrganization])
}
