"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCalendarClock, IconFlagCheck, IconInbox, IconMapPinExclamation, IconSearch, IconTruckDelivery } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useListParams } from "@workspace/ui/hooks/use-list-params"

import { useTRPC } from "@/backend/api/client"
import { SectionTiles, type SectionTile } from "@/frontend/pages/movements/components/section-links"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The work queue above the table, one tile per section that needs the
 * company: on Orders, the work partners offered it, the loads it is still
 * placing, what is on the road and what arrived; on Trips, what is ready to
 * leave, what is moving, whose driver has gone quiet today and what arrived.
 * A shipper is never offered work, so its first Orders tile is the booked
 * loads instead.
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
            session.organization.type === "carrier"
                ? { section: "inbox", label: t("inbox"), value: count("inbox"), hint: t("inbox-hint"), Icon: IconInbox }
                : { section: "booked", label: t("booked"), value: count("booked"), hint: t("booked-hint"), Icon: IconCalendarClock },
            { section: "procurement", label: t("procurement"), value: count("procurement"), hint: t("procurement-hint"), Icon: IconSearch },
            { section: "in-transit", label: t("in-transit"), value: count("in-transit"), hint: t("in-transit-hint"), Icon: IconTruckDelivery },
            { section: "delivered", label: t("delivered"), value: count("delivered"), hint: t("delivered-hint"), Icon: IconFlagCheck },
        ]
        : [
            { section: "scheduled", label: t("scheduled"), value: count("scheduled"), hint: t("scheduled-hint"), Icon: IconCalendarClock },
            { section: "in-transit", label: t("in-transit"), value: count("in-transit"), hint: t("in-transit-hint"), Icon: IconTruckDelivery },
            { section: "in-transit", silent: true, label: t("silent"), value: stats.silent, hint: t("silent-hint"), Icon: IconMapPinExclamation },
            { section: "delivered", label: t("delivered"), value: count("delivered"), hint: t("delivered-hint"), Icon: IconFlagCheck },
        ]

    return <SectionTiles scope={scope} section={section} silent={get("silent") === "1"} tiles={tiles} />
}
