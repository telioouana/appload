"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconParking, IconSearch, IconTruckOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"

/**
 * The work queue above the table: who is standing still, whose licence
 * Appload is still reviewing, and who has no truck to drive. One URL key per
 * tile, so the count a tile shows is exactly the list clicking it opens; the
 * other two availability states are a choice in the Filters popover, which
 * lists all three counts together.
 */
export function DriversStatsView() {
    const t = useTranslations("App.drivers.tiles")
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.drivers.stats.queryOptions())

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
            filter: { key: "unassigned", value: "1" },
            label: t("unassigned"),
            value: data.attention.unassigned,
            hint: t("unassigned-hint"),
            Icon: IconTruckOff,
        },
    ]

    return <AttentionTiles tiles={tiles} />
}
