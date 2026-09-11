"use client"

import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
    type Icon as TablerIcon,
    IconChevronRight,
    IconCircleCheck,
    IconFileCheck,
    IconFileDollar,
    IconInbox,
    IconSteeringWheel,
    IconUserPlus,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"

type QueueItem = {
    key: string
    Icon: TablerIcon
    label: string
    /** Undefined while the count is still on its way; 0 hides the row */
    count: number | undefined
    href: React.ComponentProps<typeof Link>["href"]
    /** How loudly the row asks: money and trucks waiting on a decision warn */
    tone?: "warn"
}

/** Every row is a link to the rows it counted, with its count on the way to it. */
function QueueRow({ item }: { item: QueueItem }) {
    const f = useFormatter()

    return (
        <Link href={item.href} className="group flex h-11 items-center gap-3 border-t text-sm first:border-t-0">
            <item.Icon
                className={cn(
                    "size-4 shrink-0",
                    item.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
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
 * What is waiting on this company specifically — the moves nobody else can
 * make for it: a decision on an offer, a quote a client is expecting, a truck
 * to name, paperwork to close, a partner asking to connect. Loads already
 * rolling are not here; they are on the tiles above and on the map beside it.
 *
 * A line only appears when it has something to say: rows at zero are gone,
 * and once every count is in and all of them are zero the card says so. The
 * connection count rides its own query, so a bad minute there loses that line
 * and nothing else.
 */
export function NeedsAHand() {
    const t = useTranslations("App.dashboard")
    const tiles = useTranslations("App.orders.tiles")
    const trpc = useTRPC()

    // Same key as the tiles above, so one fetch feeds both
    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data } = useSuspenseQuery(trpc.analytics.pipeline.queryOptions())

    // The same query the partners page's own tabs count from
    const partners = useQuery({ ...trpc.partners.stats.queryOptions(), staleTime: 60_000 })

    const shipper = session.organization.type === "shipper"
    const { attention } = data

    const orders: QueueItem[] = shipper
        ? [
            {
                key: "offers-to-review",
                Icon: IconFileDollar,
                label: tiles("offers-to-review"),
                count: attention.offersToReview,
                href: { pathname: "/appload/[section]", params: { section: "quoted" } },
                tone: "warn",
            },
            {
                key: "delivered-pending",
                Icon: IconFileCheck,
                label: tiles("delivered-pending"),
                count: attention.deliveredPending,
                href: { pathname: "/appload/[section]", params: { section: "delivered" } },
            },
        ]
        : [
            {
                key: "new-requests",
                Icon: IconInbox,
                label: tiles("new-requests"),
                count: attention.newRequests,
                href: { pathname: "/appload/[section]", params: { section: "requests" } },
                tone: "warn",
            },
            {
                key: "to-dispatch",
                Icon: IconSteeringWheel,
                label: tiles("to-dispatch"),
                count: attention.toDispatch,
                href: { pathname: "/appload/[section]", params: { section: "booked" }, query: { dispatch: "1" } },
                tone: "warn",
            },
            {
                key: "delivered-pending",
                Icon: IconFileCheck,
                label: tiles("delivered-pending"),
                count: attention.deliveredPending,
                href: { pathname: "/appload/[section]", params: { section: "delivered" } },
            },
        ]

    const rows: QueueItem[] = [
        ...orders,
        {
            key: "connections",
            Icon: IconUserPlus,
            label: t("queue.connections"),
            // A count that failed to arrive is treated as nothing to do: the
            // row drops out rather than pulsing forever
            count: partners.isError ? 0 : partners.data?.incoming,
            href: { pathname: "/partners", query: { tab: "requests" } },
            tone: "warn",
        },
    ]

    // A row earns its place by having work on it, or by not knowing yet
    const open = rows.filter((item) => item.count === undefined || item.count > 0)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-1 flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("queue.title")}</h2>

            {open.length === 0 ? (
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
                <div className="flex flex-col">
                    {open.map((item) => <QueueRow key={item.key} item={item} />)}
                </div>
            )}
        </section>
    )
}
