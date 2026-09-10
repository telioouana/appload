"use client"

import { useTranslations } from "@workspace/i18n"
import type { KycStatus, OwnershipStatus } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"

import type { FleetStatus } from "@/frontend/pages/fleet/types"

/**
 * The verification verdict, read-only in the portal: uploads and review stay
 * in Admin, so this badge is the whole of what a partner can do about KYC —
 * see it. The drivers list imports the same three so both pages label a
 * status identically.
 */
export function KycBadge({ status }: { status: KycStatus }) {
    const t = useTranslations("App.fleet.status")

    return <StatusBadge label={t(status)} status={status} />
}

export function OwnershipBadge({ status }: { status: OwnershipStatus }) {
    const t = useTranslations("App.fleet.ownership")

    return <StatusBadge label={t(status)} status={status} />
}

/**
 * Operational availability — whether the vehicle or driver is on a trip right
 * now. Deliberately not a `StatusBadge`: it is not a verdict about anyone,
 * and giving it the same visual weight as the KYC badge would read as one.
 */
export function StateBadge({ state }: { state: FleetStatus }) {
    const t = useTranslations("App.fleet.state")

    return (
        <Badge variant={state === "active" ? "default" : "secondary"} className="rounded-full font-normal">
            {t(state)}
        </Badge>
    )
}
