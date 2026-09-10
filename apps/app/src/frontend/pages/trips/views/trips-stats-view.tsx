"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCalendarClock, IconFlagCheck, IconMapPinExclamation, IconTruckDelivery } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@/components/list/attention-tiles"

/**
 * The work queue above the table: what is moving, who has gone quiet, what
 * is waiting to leave and what arrived. Each tile opens exactly the rows it
 * counted, which is why the silent ones own a filter key of their own rather
 * than a section.
 */
export function TripsStatsView() {
    const t = useTranslations("App.trips.tiles")
    const trpc = useTRPC()

    const { data: stats } = useSuspenseQuery(trpc.trips.stats.queryOptions())

    const tiles: AttentionTile[] = [
        {
            filter: { key: "section", value: "in-transit" },
            label: t("in-transit"),
            value: stats.attention.inTransit,
            hint: t("in-transit-hint"),
            Icon: IconTruckDelivery,
        },
        {
            filter: { key: "noResponse", value: "1" },
            label: t("no-response"),
            value: stats.attention.noResponseToday,
            hint: t("no-response-hint"),
            Icon: IconMapPinExclamation,
        },
        {
            filter: { key: "section", value: "scheduled" },
            label: t("scheduled"),
            value: stats.attention.scheduled,
            hint: t("scheduled-hint"),
            Icon: IconCalendarClock,
        },
        {
            // The tile opens every delivered trip, so that is what it counts;
            // this month's share is the line underneath rather than a second
            // number the filter would not reproduce
            filter: { key: "section", value: "delivered" },
            label: t("delivered"),
            value: stats.attention.delivered,
            hint: t("delivered-hint", { count: stats.attention.deliveredThisMonth }),
            Icon: IconFlagCheck,
        },
    ]

    // The open panel belongs to the list being left, and a tile keyed on the
    // filter must not inherit whichever section tab happened to be open
    return <AttentionTiles tiles={tiles} reset={["id", "sel", "section"]} />
}
