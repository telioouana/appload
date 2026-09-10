"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconClockExclamation, IconFileCheck, IconMailForward } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@/components/list/attention-tiles"

/**
 * The work queue above the table: the prices still on the table, the ones
 * about to lapse, and what turned into work this month. Each tile opens
 * exactly the rows it counted, which is why the standing and expiring ones
 * own different URL keys.
 */
export function QuotesStatsView() {
    const t = useTranslations("App.quotes.tiles")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.quotes.stats.queryOptions())

    const orgType = session.organization.type

    const tiles: AttentionTile[] = [
        {
            filter: { key: "status", value: "sent" },
            label: t(`standing.${orgType}`),
            value: stats.byStatus.sent,
            hint: t(`standing-hint.${orgType}`),
            Icon: IconMailForward,
        },
        {
            filter: { key: "expiring", value: "1" },
            label: t("expiring"),
            value: stats.expiringSoon,
            hint: t("expiring-hint"),
            Icon: IconClockExclamation,
        },
        {
            // The tile opens every accepted quote, so that is what it counts;
            // this month's share is the line underneath rather than a second
            // number the filter would not reproduce
            filter: { key: "status", value: "accepted" },
            label: t("accepted"),
            value: stats.byStatus.accepted,
            hint: t("accepted-hint", { count: stats.acceptedThisMonth }),
            Icon: IconFileCheck,
        },
    ]

    // The open panel belongs to the list being left, and a tile always opens
    // exactly the rows it counted rather than a slice of the current status
    return <AttentionTiles tiles={tiles} reset={["id", "sel"]} />
}
