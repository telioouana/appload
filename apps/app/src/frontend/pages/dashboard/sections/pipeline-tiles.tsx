"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconBox, IconClockHour4, IconFileCheck, IconFileDollar, IconInbox, IconRoute, IconSteeringWheel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { StatTile, type StatTileProps } from "@/frontend/pages/dashboard/components/stat-tile"
import { defaultTab } from "@/frontend/pages/movements/types"

/**
 * The five numbers the day starts with: how big the company's order book is,
 * then the four things standing on it. The two sides of a deal are asked
 * different questions — a client about the round it opened and the offers it
 * has not decided, a carrier about the requests it has not answered and the
 * loads it has not staffed — so the middle tiles change with the type while
 * the outer ones do not.
 *
 * Every label is the orders page's own, so a tile and the page it opens can
 * never say the same number two different ways.
 */
export function PipelineTiles() {
    const t = useTranslations("App.dashboard")
    const tiles = useTranslations("App.orders.tiles")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data } = useSuspenseQuery(trpc.analytics.pipeline.queryOptions())

    const shipper = session.organization.type === "shipper"
    // Appload's loads are the company's own: each tile opens the section of
    // the Orders page that holds them, on the tab this company lands on
    const tab = defaultTab(session.organization.type)
    const { attention } = data

    const onTheRoad: StatTileProps & { key: string } = {
        key: "on-the-road",
        Icon: IconRoute,
        label: tiles("on-the-road"),
        value: attention.onTheRoad,
        hint: tiles("on-the-road-hint"),
        href: { pathname: "/orders/[section]", params: { section: "in-progress" }, query: { tab } },
    }

    const delivered: StatTileProps & { key: string } = {
        key: "delivered-pending",
        Icon: IconFileCheck,
        label: tiles("delivered-pending"),
        value: attention.deliveredPending,
        hint: tiles(shipper ? "delivered-pending-hint.shipper" : "delivered-pending-hint.carrier"),
        href: { pathname: "/orders/[section]", params: { section: "delivered" }, query: { tab } },
    }

    const row: Array<StatTileProps & { key: string }> = shipper
        ? [
            {
                key: "total",
                Icon: IconBox,
                label: t("total.label"),
                value: data.total,
                hint: t("total.hint.shipper"),
                href: { pathname: "/orders/[section]", params: { section: "all" }, query: { tab } },
            },
            {
                key: "awaiting-offers",
                Icon: IconClockHour4,
                label: tiles("awaiting-offers"),
                value: attention.awaitingOffers,
                hint: tiles("awaiting-offers-hint"),
                href: { pathname: "/orders/[section]", params: { section: "procurement" }, query: { tab } },
            },
            {
                key: "offers-to-review",
                Icon: IconFileDollar,
                label: tiles("offers-to-review"),
                value: attention.offersToReview,
                hint: tiles("offers-to-review-hint"),
                href: { pathname: "/orders/[section]", params: { section: "procurement" }, query: { tab } },
            },
            onTheRoad,
            delivered,
        ]
        : [
            {
                key: "total",
                Icon: IconBox,
                label: t("total.label"),
                value: data.total,
                hint: t("total.hint.carrier"),
                // No door: a carrier's Appload book is spread over the
                // requests it was asked, the quotes it gave and the loads it
                // carries, which no one section of the Orders page holds
            },
            {
                key: "new-requests",
                Icon: IconInbox,
                label: tiles("new-requests"),
                value: attention.newRequests,
                hint: tiles("new-requests-hint"),
                href: { pathname: "/orders/[section]", params: { section: "procurement" }, query: { tab } },
            },
            {
                key: "to-dispatch",
                Icon: IconSteeringWheel,
                label: tiles("to-dispatch"),
                value: attention.toDispatch,
                hint: tiles("to-dispatch-hint"),
                href: { pathname: "/orders/[section]", params: { section: "booked" }, query: { tab } },
            },
            onTheRoad,
            delivered,
        ]

    return (
        <div className="grid grid-cols-2 gap-3 px-2 sm:grid-cols-3 xl:grid-cols-5">
            {row.map(({ key, ...tile }) => <StatTile key={key} {...tile} />)}
        </div>
    )
}
