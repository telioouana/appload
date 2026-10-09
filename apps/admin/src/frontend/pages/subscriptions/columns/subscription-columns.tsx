"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { IconBuilding } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Dash, IdentityCell, initials, Mono } from "@workspace/ui/customs/list/table-cells"

import { cn } from "@workspace/ui/lib/utils"

import { EXPIRING_WINDOW_DAYS, type SubscriptionRow, type SubscriptionState } from "@/frontend/pages/subscriptions/types"

const DAY = 86_400_000

/** The badge's vocabulary: the tabs' states plus "cancelled" for a plan running out on purpose. */
type BadgeState = SubscriptionState | "cancelled"

/** Where a row stands today, and how many days it has left when that matters. */
export function stateOf(row: SubscriptionRow, now: Date): { state: BadgeState; days: number } {
    if (!row.expiresAt) return { state: "active", days: Infinity }

    const days = Math.ceil((row.expiresAt.getTime() - now.getTime()) / DAY)
    if (days <= 0) return { state: "expired", days }
    if (row.cancelledAt) return { state: "cancelled", days }
    if (days <= EXPIRING_WINDOW_DAYS) return { state: "expiring", days }

    return { state: "active", days }
}

const STATE_CLASSES: Record<BadgeState, string> = {
    active: "bg-[var(--status-verified-bg)] text-[var(--status-verified-text)]",
    expiring: "bg-[var(--status-expired-bg)] text-[var(--status-expired-text)]",
    expired: "bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)]",
    cancelled: "bg-muted text-muted-foreground",
}

export function StateBadge({ row, now }: { row: SubscriptionRow; now: Date }) {
    const t = useTranslations("Admin.subscriptions.state")
    const { state, days } = stateOf(row, now)

    // The end date a cancelled plan runs to is the row's own Expires column
    return (
        <Badge variant="outline" className={cn("rounded-full border-none", STATE_CLASSES[state])}>
            {state === "expiring" ? t("expiring", { days }) : t(state)}
        </Badge>
    )
}

export function useSubscriptionColumns({ now, onProfile }: { now: Date; onProfile: (row: SubscriptionRow) => void }) {
    const t = useTranslations("Admin.subscriptions")
    const f = useFormatter()

    return useMemo<ColumnDef<SubscriptionRow, unknown>[]>(() => [
        {
            id: "name",
            accessorKey: "name",
            header: t("columns.company"),
            enableHiding: false,
            size: 240,
            meta: { label: t("columns.company"), sortKey: "name" },
            cell: ({ row }) => (
                <IdentityCell
                    image={row.original.logo}
                    fallback={initials(row.original.name)}
                    name={row.original.name}
                    sub={t(`filters.type-options.${row.original.type}`)}
                />
            ),
        },
        {
            id: "plan",
            accessorKey: "plan",
            header: t("columns.plan"),
            size: 120,
            meta: { label: t("columns.plan"), sortKey: "plan" },
            cell: ({ row }) => <Badge variant="secondary">{t(`plan.${row.original.plan}`)}</Badge>,
        },
        {
            id: "state",
            header: t("columns.state"),
            size: 140,
            meta: { label: t("columns.state") },
            cell: ({ row }) => <StateBadge row={row.original} now={now} />,
        },
        {
            id: "expires",
            accessorKey: "expiresAt",
            header: t("columns.expires"),
            size: 140,
            meta: { label: t("columns.expires"), sortKey: "expires" },
            cell: ({ row }) =>
                row.original.expiresAt
                    ? <span>{f.dateTime(row.original.expiresAt, { dateStyle: "medium" })}</span>
                    : <span className="text-muted-foreground">{t("values.no-expiry")}</span>,
        },
        {
            id: "usage",
            header: t("columns.usage"),
            size: 140,
            meta: { label: t("columns.usage") },
            cell: ({ row }) => {
                const { used, quota, extra } = row.original
                // Nothing to spend once expired: the figure would only mislead
                if (stateOf(row.original, now).state === "expired") return <Dash />
                if (quota === null) return <Mono>{t("values.unlimited", { used })}</Mono>
                // Past the plan: the extras are what staff invoice
                if (extra > 0) return <Mono className="text-destructive">{t("values.usage-extra", { used, quota, extra })}</Mono>

                return <Mono>{t("values.usage", { used, quota })}</Mono>
            },
        },
        {
            id: "portal",
            header: t("columns.portal"),
            size: 170,
            meta: { label: t("columns.portal") },
            cell: ({ row }) =>
                row.original.portalActivatedAt
                    ? <span className="text-[13px]">{t("values.portal-since", { date: f.dateTime(row.original.portalActivatedAt, { dateStyle: "medium" }) })}</span>
                    : <span className="text-muted-foreground text-[13px]">{t("values.portal-inactive")}</span>,
        },
        {
            id: "actions",
            header: "",
            enableHiding: false,
            size: 48,
            meta: { label: t("columns.actions"), align: "right" },
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("values.open-profile")}
                    title={t("values.open-profile")}
                    onClick={(event) => {
                        event.stopPropagation()
                        onProfile(row.original)
                    }}
                >
                    <IconBuilding className="size-4" stroke={1.5} />
                </Button>
            ),
        },
    ], [t, f, now, onProfile])
}
