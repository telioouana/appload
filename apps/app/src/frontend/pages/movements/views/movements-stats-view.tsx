"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCalendarClock, IconCalendarCheck, IconFlagCheck, IconInbox, IconMapPinExclamation, IconSearch, IconSteeringWheel, IconTruckDelivery } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

import { useTRPC } from "@/backend/api/client"
import { SectionTiles, type SectionTile } from "@/frontend/pages/movements/components/section-links"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The work queue above the table, one tile per section that needs the
 * company: on Orders, the loads it is still placing, what is booked in, what
 * is in progress and what arrived; on Trips, what is still being planned,
 * what is booked in, what is in progress and whose driver has gone quiet
 * today. A transporter's Trips open on the loads partners offered it, which
 * wait in Planning under the Prospect tab until it answers.
 *
 * That tile counts the offers alone, while the tab it opens also lists the
 * quotes the company set by hand on its own trips: a tile may open on more
 * than it counted, never on less.
 */
export function MovementsStatsView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads.tiles")
    const trpc = useTRPC()
    const { get } = useListParams()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope }))

    const count = (value: MovementSection) => stats.bySection[value] ?? 0

    const tiles: SectionTile[] = scope === "orders"
        ? [
            { section: "procurement", label: t("procurement"), value: count("procurement"), hint: t("procurement-hint"), Icon: IconSearch },
            { section: "booked", label: t("booked"), value: count("booked"), hint: t("booked-hint"), Icon: IconCalendarCheck },
            { section: "in-progress", label: t("in-progress"), value: count("in-progress"), hint: t("in-progress-hint"), Icon: IconTruckDelivery },
            { section: "delivered", label: t("delivered"), value: count("delivered"), hint: t("delivered-hint"), Icon: IconFlagCheck },
        ]
        : [
            ...(session.organization.type === "carrier"
                ? [{ section: "planning", status: "prospect", label: t("received"), value: stats.received, hint: t("received-hint"), Icon: IconInbox } satisfies SectionTile]
                : []),
            { section: "planning", label: t("planning"), value: count("planning"), hint: t("planning-hint"), Icon: IconSteeringWheel },
            { section: "scheduled", label: t("scheduled"), value: count("scheduled"), hint: t("scheduled-hint"), Icon: IconCalendarClock },
            { section: "in-progress", label: t("in-progress"), value: count("in-progress"), hint: t("in-progress-hint"), Icon: IconTruckDelivery },
            { section: "in-progress", silent: true, label: t("silent"), value: stats.silent, hint: t("silent-hint"), Icon: IconMapPinExclamation },
        ]

    return <SectionTiles scope={scope} section={section} silent={get("silent") === "1"} status={get("status")} tiles={tiles} />
}
