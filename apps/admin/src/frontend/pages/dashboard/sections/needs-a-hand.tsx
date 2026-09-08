"use client"

import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
    type Icon as TablerIcon,
    IconAlertTriangle,
    IconAntennaOff,
    IconBuildingFactory2,
    IconBuildingWarehouse,
    IconChevronRight,
    IconCircleCheck,
    IconClockExclamation,
    IconFlag,
    IconGavel,
    IconLink as IconLinkVehicle,
    IconMessages,
    IconTruck,
    IconTruckLoading,
    IconUsers,
} from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { Link } from "@/i18n/navigation"

import { isSilent, tilesStatsInput, UNREAD_POLL_MS } from "@/frontend/pages/dashboard/types"
import { OVERVIEW_POLL_MS } from "@/frontend/pages/map/types"
import { LOADING_WINDOW_DAYS } from "@/frontend/pages/orders/types"

type QueueItem = {
    key: string
    Icon: TablerIcon
    label: string
    /** Undefined while the count is still on its way; 0 hides the row */
    count: number | undefined
    href: React.ComponentProps<typeof Link>["href"]
    /** How loudly the row asks: stopped trips shout, late and silent ones warn */
    tone?: "danger" | "warn"
}

/** Every row is a link to the rows it counted, with its count on the way to it. */
function QueueRow({ item }: { item: QueueItem }) {
    const f = useFormatter()

    return (
        <Link
            href={item.href}
            className="group flex h-11 items-center gap-3 border-t text-sm first:border-t-0"
        >
            <item.Icon
                className={cn(
                    "size-4 shrink-0",
                    item.tone === "danger" ? "text-destructive"
                        : item.tone === "warn" ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                )}
                stroke={1.5}
            />

            <span className="min-w-0 flex-1 truncate">{item.label}</span>

            {item.count === undefined ? (
                <Skeleton className="h-5 w-10 rounded-full" />
            ) : (
                <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
                    {f.number(item.count)}
                </span>
            )}

            <IconChevronRight
                className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
                stroke={1.5}
            />
        </Link>
    )
}

/**
 * The day's queue: everything waiting on an operator, each line landing on
 * exactly the list it counts. Trips first — stopped, flagged, late, disputed,
 * unanswered, out of contact — then the paperwork waiting for a decision.
 *
 * A line only appears when it has something to say: rows at zero are gone,
 * and once every count is in and all of them are zero the card says so. The
 * counts other than the order stats each ride their own query, so a role
 * without the permission (or a procedure having a bad minute) loses its line
 * and nothing else.
 */
export function NeedsAHand() {
    const t = useTranslations("Admin.dashboard")
    const trpc = useTRPC()
    const now = useNow({ updateInterval: 60_000 })

    // Same key and same staleTime as the tiles above, so one fetch feeds both
    const { data: stats } = useSuspenseQuery({ ...trpc.orders.stats.queryOptions(tilesStatsInput()), staleTime: 60_000 })

    // The same three queries the sidebar badges run, so they share one cache
    const disputes = useQuery({ ...trpc.disputes.attention.queryOptions(), staleTime: 60_000 })
    const unread = useQuery({ ...trpc.chats.unread.queryOptions(), refetchInterval: UNREAD_POLL_MS })
    const review = useQuery({ ...trpc.partners.reviewQueue.queryOptions(), staleTime: 60_000 })
    const fleet = useQuery(trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }))

    // A count that failed to arrive is treated as nothing to do: the row
    // drops out rather than pulsing forever at a role that cannot read it
    const disputeCount = disputes.isError ? 0 : disputes.data
    const unreadCount = unread.isError ? 0 : unread.data
    const silent = fleet.isError ? 0 : fleet.data?.filter((order) => isSilent(order, now.getTime())).length

    // One query behind six rows, so they arrive and disappear together
    const pending = (pick: (queue: NonNullable<typeof review.data>) => number) =>
        review.isError ? 0 : review.data && pick(review.data)

    const trips: QueueItem[] = [
        {
            key: "interrupted",
            Icon: IconAlertTriangle,
            label: t("queue.interrupted"),
            count: stats.attention.interrupted,
            href: { pathname: "/orders/all", query: { interrupted: "1" } },
            tone: "danger",
        },
        {
            key: "flagged",
            Icon: IconFlag,
            label: t("queue.flagged"),
            count: stats.attention.flagged,
            href: { pathname: "/orders/all", query: { flagged: "1" } },
        },
        {
            key: "overdue",
            Icon: IconClockExclamation,
            label: t("queue.overdue"),
            count: stats.pipeline.loadingOverdue,
            // The list has no "overdue" filter of its own; the loading window
            // sorted by date ascending puts the late ones at the top
            href: { pathname: "/orders/all", query: { loading: String(LOADING_WINDOW_DAYS), sort: "loading", dir: "asc" } },
            tone: "warn",
        },
        {
            key: "disputes",
            Icon: IconGavel,
            label: t("queue.disputes"),
            count: disputeCount,
            href: "/orders/disputes",
        },
        {
            key: "unread",
            Icon: IconMessages,
            label: t("queue.unread"),
            count: unreadCount,
            href: "/messages",
        },
        {
            key: "silent",
            Icon: IconAntennaOff,
            label: t("queue.silent"),
            count: silent,
            href: "/map",
            tone: "warn",
        },
    ]

    const documents: QueueItem[] = [
        {
            key: "shippers",
            Icon: IconBuildingFactory2,
            label: t("queue.shippers"),
            count: pending((queue) => queue.shippers),
            href: { pathname: "/shippers", query: { status: "pending-review" } },
        },
        {
            key: "carriers",
            Icon: IconBuildingWarehouse,
            label: t("queue.carriers"),
            count: pending((queue) => queue.carriers),
            href: { pathname: "/carriers/all", query: { status: "pending-review" } },
        },
        {
            key: "drivers",
            Icon: IconUsers,
            label: t("queue.drivers"),
            count: pending((queue) => queue.drivers),
            href: { pathname: "/carriers/drivers", query: { status: "pending-review" } },
        },
        {
            key: "trucks",
            Icon: IconTruck,
            label: t("queue.trucks"),
            count: pending((queue) => queue.fleetByKind.truck),
            href: { pathname: "/carriers/fleets", query: { kind: "truck", status: "pending-review" } },
        },
        {
            key: "trailers",
            Icon: IconTruckLoading,
            label: t("queue.trailers"),
            count: pending((queue) => queue.fleetByKind.trailer),
            href: { pathname: "/carriers/fleets", query: { kind: "trailer", status: "pending-review" } },
        },
        {
            key: "links",
            Icon: IconLinkVehicle,
            label: t("queue.links"),
            count: pending((queue) => queue.fleetByKind.link),
            href: { pathname: "/carriers/fleets", query: { kind: "link", status: "pending-review" } },
        },
    ]

    // A row earns its place by having work on it, or by not knowing yet
    const worth = (item: QueueItem) => item.count === undefined || item.count > 0
    const openTrips = trips.filter(worth)
    const openDocuments = documents.filter(worth)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("queue.title")}</h2>

            {openTrips.length === 0 && openDocuments.length === 0 ? (
                <Empty className="p-6">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconCircleCheck />
                        </EmptyMedia>
                        <EmptyTitle>{t("queue.clear-title")}</EmptyTitle>
                        <EmptyDescription>{t("queue.clear-description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <>
                    {openTrips.length > 0 && (
                        <div className="flex flex-col">
                            {openTrips.map((item) => <QueueRow key={item.key} item={item} />)}
                        </div>
                    )}

                    {openDocuments.length > 0 && (
                        <>
                            <span className="text-muted-foreground text-xs font-medium">{t("queue.review")}</span>

                            <div className="flex flex-col">
                                {openDocuments.map((item) => <QueueRow key={item.key} item={item} />)}
                            </div>
                        </>
                    )}
                </>
            )}
        </section>
    )
}
