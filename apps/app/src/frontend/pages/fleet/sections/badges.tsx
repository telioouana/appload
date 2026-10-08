"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { KycStatus, OwnershipStatus } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"

import { Link } from "@/i18n/navigation"
import type { FleetStatus, VehicleRental } from "@/frontend/pages/fleet/types"

/**
 * The verification verdict. A partner files the papers behind it from the
 * profile sheets, but never decides it: the verdict is derived from what
 * Appload has reviewed, so this badge stays a reading. The drivers list
 * imports the same three so both pages label a status identically.
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
/** The truck is at a client's service today; the chip opens the rental. */
export function RentalBadge({ rental }: { rental: VehicleRental }) {
    const t = useTranslations("App.fleet.values")
    const f = useFormatter()
    const until = rental.until ? new Date(`${rental.until}T00:00:00`) : null

    return (
        <Link
            href={{ pathname: "/orders/rental/[orderId]", params: { orderId: rental.contractId } }}
            onClick={(event) => event.stopPropagation()}
            title={rental.with ? t("with", { name: rental.with }) : undefined}
            className="inline-flex max-w-full items-center rounded-full border border-amber-500/40 px-2 py-px text-[11px] leading-4 text-amber-700 hover:underline dark:text-amber-400"
        >
            <span className="truncate">
                {until ? t("on-rental-until", { date: f.dateTime(until, { day: "2-digit", month: "short" }) }) : t("on-rental")}
            </span>
        </Link>
    )
}

export function StateBadge({ state }: { state: FleetStatus }) {
    const t = useTranslations("App.fleet.state")

    return (
        <Badge variant={state === "active" ? "default" : "secondary"} className="rounded-full font-normal">
            {t(state)}
        </Badge>
    )
}
