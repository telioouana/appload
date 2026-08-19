"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { StatCards } from "@/components/list/stat-cards"
import { currentKind, EXPIRY_WINDOW_DAYS, FILTER_KEYS } from "@/frontend/pages/partners/types"
import type { StatsBucket } from "@/frontend/pages/partners/types"

/**
 * The stat strip is the page's primary filter, so each number is the count
 * of exactly the rows its card opens — the card carries the filter, not just
 * a label, so the two cannot drift apart.
 */
function Cards({ stats }: { stats: StatsBucket }) {
    const t = useTranslations("Admin.partners.stats")

    return (
        <StatCards
            filterKeys={FILTER_KEYS}
            cards={[
                { label: t("total"), value: stats.total },
                {
                    label: t("pending-review"),
                    value: stats.pendingReview,
                    filter: { key: "status", value: "pending-review" },
                },
                {
                    label: t("verified"),
                    value: stats.verified,
                    filter: { key: "status", value: "verified" },
                },
                {
                    label: t("expiring", { days: EXPIRY_WINDOW_DAYS }),
                    value: stats.expiring,
                    filter: { key: "expiring", value: String(EXPIRY_WINDOW_DAYS) },
                },
            ]}
        />
    )
}

export function OrganizationStatsView({ type }: { type: "shipper" | "carrier" }) {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.partners.organizationStats.queryOptions({ type }))

    return <Cards stats={data} />
}

export function DriverStatsView() {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.partners.driverStats.queryOptions())

    return <Cards stats={data} />
}

export function VehicleStatsView() {
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const kind = currentKind((key) => searchParams.get(key))

    const { data } = useSuspenseQuery(trpc.partners.vehicleStats.queryOptions({ kind }))

    return <Cards stats={data} />
}
