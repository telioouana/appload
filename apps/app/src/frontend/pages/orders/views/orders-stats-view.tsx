"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconClockHour4, IconFileCheck, IconFileDollar, IconInbox, IconRoute, IconSteeringWheel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { useListParams } from "@/components/list/use-list-params"
import { AttentionLinks, type AttentionLink } from "@/frontend/pages/orders/components/attention-links"
import type { OrderSection } from "@/frontend/pages/orders/types"

/**
 * The four things waiting on this company, in the order they cost money:
 * a client is asked about the round it started and the offers it has not
 * decided, a carrier about the requests it has not answered and the trips it
 * has not staffed. Each tile opens the section it counted.
 */
export function OrdersStatsView({ section }: { section: OrderSection }) {
    const t = useTranslations("App.orders.tiles")
    const trpc = useTRPC()
    const { get } = useListParams()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data } = useSuspenseQuery(trpc.orders.stats.queryOptions())

    const { attention } = data

    const tiles: AttentionLink[] = session.organization.type === "shipper"
        ? [
            {
                section: "requests",
                label: t("awaiting-offers"),
                value: attention.awaitingOffers,
                hint: t("awaiting-offers-hint"),
                Icon: IconClockHour4,
            },
            {
                section: "quoted",
                label: t("offers-to-review"),
                value: attention.offersToReview,
                hint: t("offers-to-review-hint"),
                Icon: IconFileDollar,
            },
            {
                section: "on-going",
                label: t("on-the-road"),
                value: attention.onTheRoad,
                hint: t("on-the-road-hint"),
                Icon: IconRoute,
            },
            {
                section: "delivered",
                label: t("delivered-pending"),
                value: attention.deliveredPending,
                hint: t("delivered-pending-hint.shipper"),
                Icon: IconFileCheck,
            },
        ]
        : [
            {
                section: "requests",
                label: t("new-requests"),
                value: attention.newRequests,
                hint: t("new-requests-hint"),
                Icon: IconInbox,
            },
            {
                section: "booked",
                dispatch: true,
                label: t("to-dispatch"),
                value: attention.toDispatch,
                hint: t("to-dispatch-hint"),
                Icon: IconSteeringWheel,
            },
            {
                section: "on-going",
                label: t("on-the-road"),
                value: attention.onTheRoad,
                hint: t("on-the-road-hint"),
                Icon: IconRoute,
            },
            {
                section: "delivered",
                label: t("delivered-pending"),
                value: attention.deliveredPending,
                hint: t("delivered-pending-hint.carrier"),
                Icon: IconFileCheck,
            },
        ]

    return <AttentionLinks tiles={tiles} section={section} dispatch={Boolean(get("dispatch"))} />
}
