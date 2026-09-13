"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconCircleCheck, IconInbox, IconSearch, IconSteeringWheel, IconTruckDelivery, IconUsersGroup } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { StatTile, type StatTileProps } from "@/frontend/pages/dashboard/components/stat-tile"

/**
 * The company's own loads at a glance, before anything Appload brokers for
 * it: what partners are waiting on it to answer (a shipper, which is never
 * offered work, sees what a partner has confirmed instead), what it is still
 * drafting, what its own fleet has still to plan, and what its trucks and
 * its partners' have on the road.
 *
 * Every number is a section of the Orders or Trips list and opens it — the
 * same stats those lists' own tiles read.
 */
export function LoadsTiles() {
    const t = useTranslations("App.dashboard.loads")
    const tiles = useTranslations("App.loads.tiles")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: orders } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope: "orders" }))
    const { data: trips } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope: "trips" }))

    const carrier = session.organization.type === "carrier"
    const count = (stats: typeof orders, section: string) => stats.bySection[section] ?? 0

    const row: Array<StatTileProps & { key: string }> = [
        carrier
            ? {
                key: "inbox",
                Icon: IconInbox,
                label: tiles("inbox"),
                value: count(orders, "inbox"),
                hint: tiles("inbox-hint"),
                href: { pathname: "/orders/[section]", params: { section: "inbox" } },
            }
            : {
                key: "confirmed",
                Icon: IconCircleCheck,
                label: tiles("confirmed"),
                value: count(orders, "confirmed"),
                hint: tiles("confirmed-hint"),
                href: { pathname: "/orders/[section]", params: { section: "confirmed" } },
            },
        {
            key: "procurement",
            Icon: IconSearch,
            label: tiles("procurement"),
            value: count(orders, "procurement"),
            hint: tiles("procurement-hint"),
            href: { pathname: "/orders/[section]", params: { section: "procurement" } },
        },
        {
            key: "planning",
            Icon: IconSteeringWheel,
            label: t("planning"),
            value: count(trips, "planning"),
            hint: t("planning-hint"),
            href: { pathname: "/trips/[section]", params: { section: "planning" } },
        },
        {
            key: "own-road",
            Icon: IconTruckDelivery,
            label: t("own-road"),
            value: count(trips, "in-transit"),
            hint: t("own-road-hint"),
            href: { pathname: "/trips/[section]", params: { section: "in-transit" } },
        },
        {
            key: "partner-road",
            Icon: IconUsersGroup,
            label: t("partner-road"),
            value: count(orders, "in-transit"),
            hint: t("partner-road-hint"),
            href: { pathname: "/orders/[section]", params: { section: "in-transit" } },
        },
    ]

    return (
        <div className="grid grid-cols-2 gap-3 px-2 sm:grid-cols-3 xl:grid-cols-5">
            {row.map(({ key, ...tile }) => <StatTile key={key} {...tile} />)}
        </div>
    )
}

