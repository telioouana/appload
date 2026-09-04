"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconClockExclamation, IconEyeExclamation, IconFileOff, IconHelpCircle, IconPhoneOff, IconSearch, IconSteeringWheel, IconUserQuestion } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@/components/list/attention-tiles"
import { currentKind, EXPIRY_WINDOW_DAYS } from "@/frontend/pages/partners/types"
import type { StatsBucket, VehicleKind } from "@/frontend/pages/partners/types"

/**
 * The work queue for each page: the two tiles every partner shares (review
 * and expiry) plus two that name that page's own gaps. Each tile counts
 * exactly the rows its filter opens, so a number is never a surprise.
 */
function useTiles(stats: StatsBucket, page: "shipper" | "carrier" | "driver" | VehicleKind): AttentionTile[] {
    const t = useTranslations("Admin.partners.tiles")

    const shared: AttentionTile[] = [
        {
            filter: { key: "status", value: "pending-review" },
            label: t("pending-review"),
            value: stats.byStatus["pending-review"],
            hint: t(`pending-review-hint.${page === "shipper" || page === "carrier" ? "organization" : page === "driver" ? "driver" : "vehicle"}`),
            Icon: IconSearch,
        },
        {
            filter: { key: "expiring", value: String(EXPIRY_WINDOW_DAYS) },
            label: t("expiring", { days: EXPIRY_WINDOW_DAYS }),
            value: stats.expiring,
            hint: t(`expiring-hint.${page === "shipper" || page === "carrier" ? "organization" : page === "driver" ? "driver" : "vehicle"}`),
            Icon: IconClockExclamation,
        },
    ]

    if (page === "shipper") {
        return [
            ...shared,
            { filter: { key: "incomplete", value: "1" }, label: t("incomplete"), value: stats.attention.incomplete ?? 0, hint: t("incomplete-hint"), Icon: IconUserQuestion },
            { filter: { key: "risk", value: "flagged" }, label: t("risk"), value: stats.attention.risk ?? 0, hint: t("risk-hint"), Icon: IconEyeExclamation },
        ]
    }

    if (page === "carrier") {
        return [
            ...shared,
            { filter: { key: "incomplete", value: "1" }, label: t("incomplete"), value: stats.attention.incomplete ?? 0, hint: t("incomplete-hint"), Icon: IconUserQuestion },
            { filter: { key: "contract", value: "missing" }, label: t("contract"), value: stats.attention.contract ?? 0, hint: t("contract-hint"), Icon: IconFileOff },
        ]
    }

    if (page === "driver") {
        return [
            ...shared,
            { filter: { key: "phone", value: "missing" }, label: t("phone"), value: stats.attention.phone ?? 0, hint: t("phone-hint"), Icon: IconPhoneOff },
            { filter: { key: "unassigned", value: "1" }, label: t("unassigned-driver"), value: stats.attention.unassigned ?? 0, hint: t("unassigned-driver-hint"), Icon: IconSteeringWheel },
        ]
    }

    return [
        ...shared,
        { filter: { key: "ownership", value: "unverified" }, label: t("ownership"), value: stats.attention.ownership ?? 0, hint: t("ownership-hint"), Icon: IconHelpCircle },
        {
            filter: { key: "unassigned", value: "1" },
            label: t(`unassigned-${page}`),
            value: stats.attention.unassigned ?? 0,
            hint: t(`unassigned-${page}-hint`),
            Icon: IconSteeringWheel,
        },
    ]
}

function Tiles({ stats, page }: { stats: StatsBucket; page: "shipper" | "carrier" | "driver" | VehicleKind }) {
    const tiles = useTiles(stats, page)

    return <AttentionTiles tiles={tiles} />
}

export function OrganizationStatsView({ type }: { type: "shipper" | "carrier" }) {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.partners.organizationStats.queryOptions({ type }))

    return <Tiles stats={data} page={type} />
}

export function DriverStatsView() {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.partners.driverStats.queryOptions())

    return <Tiles stats={data} page="driver" />
}

export function VehicleStatsView() {
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const kind = currentKind((key) => searchParams.get(key))

    const { data } = useSuspenseQuery(trpc.partners.vehicleStats.queryOptions({ kind }))

    return <Tiles stats={data} page={kind} />
}
