"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconHelpCircle, IconParking, IconSearch, IconSteeringWheel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@/components/list/attention-tiles"
import type { VehicleKind } from "@/frontend/pages/fleet/types"

/**
 * The work queue above the table: what is standing still, what Appload is
 * still waiting on, and the two gaps only the carrier can close. Each tile
 * counts exactly the rows its filter opens, so a number is never a surprise —
 * which is also why each one owns a different URL key.
 *
 * Availability is only represented here by "idle"; the other two states are a
 * choice in the Filters popover, where all three counts are shown together.
 */
export function FleetStatsView({ kind }: { kind: VehicleKind }) {
    const t = useTranslations("App.fleet.tiles")
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.fleet.vehicles.stats.queryOptions({ kind }))

    const tiles: AttentionTile[] = [
        {
            filter: { key: "state", value: "idle" },
            label: t("idle"),
            value: data.byState.idle,
            hint: t("idle-hint"),
            Icon: IconParking,
        },
        {
            filter: { key: "status", value: "pending-review" },
            label: t("pending-review"),
            value: data.byStatus["pending-review"],
            hint: t("pending-review-hint"),
            Icon: IconSearch,
        },
        {
            filter: { key: "ownership", value: "unverified" },
            label: t("ownership"),
            value: data.attention.ownership,
            hint: t("ownership-hint"),
            Icon: IconHelpCircle,
        },
        {
            filter: { key: "unassigned", value: "1" },
            label: t(`unassigned.${kind}`),
            value: data.attention.unassigned,
            hint: t(`unassigned-hint.${kind}`),
            Icon: IconSteeringWheel,
        },
    ]

    return <AttentionTiles tiles={tiles} />
}
