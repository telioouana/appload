"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconArrowNarrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { TRAIL_POLL_MS } from "@workspace/maps/types"
import { cn } from "@workspace/ui/lib/utils"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { PlateChip } from "@workspace/ui/customs/list/table-cells"
import { TripRouteMap } from "@/frontend/pages/trips/components/trip-route-map"
import { LastPingCell, TripStatusChip, place } from "@/frontend/pages/trips/components/badges"
import { TripActions } from "@/frontend/pages/trips/sections/trip-actions"
import type { TripDetail, TripRequestView } from "@/frontend/pages/trips/types"

/**
 * One trip on one page: where it is going, where it has been, when we last
 * asked, and what its owner can do about it. This file owns the queries and
 * hands each block what it renders; every permission on it was decided by
 * the server.
 */
export function TripDetailView({ tripId }: { tripId: string }) {
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: trip } = useSuspenseQuery(trpc.trips.get.queryOptions({ id: tripId }))

    return (
        <>
            <DetailHeader
                trip={trip}
                allowance={session.allowance}
                organizationName={session.organization.name}
            />

            {/* From lg up the page itself does not scroll: the left column
                does, so the trail on the right stays where it was. Below lg
                it is one column and the page scrolls instead. */}
            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]">
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <RouteCard trip={trip} />
                    <RequestsCard requests={trip.requests} />
                </div>

                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <PingsCard trip={trip} />
                </div>
            </div>
        </>
    )
}

function DetailHeader({
    trip,
    allowance,
    organizationName,
}: {
    trip: TripDetail
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.trips")

    return (
        <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <Button asChild size="icon" variant="outline" aria-label={t("detail.back")} className="mt-4 shrink-0">
                    <Link href="/trips">
                        <IconArrowLeft className="size-4" stroke={1.5} />
                    </Link>
                </Button>

                <div className="flex min-w-0 flex-col gap-1">
                    <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span>{t("eyebrow")}</span>
                        <span aria-hidden>/</span>
                        <span className="text-foreground/70">{t(`sections.${sectionFor(trip)}`)}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{trip.ref}</h1>
                        <TripStatusChip status={trip.status} />
                        {trip.truckPlate && <PlateChip plate={trip.truckPlate} />}
                    </div>

                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="truncate">{trip.driverName}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{trip.driverPhone}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{place(trip.origin)} → {place(trip.destination)}</span>
                    </p>
                </div>
            </div>

            <div className="shrink-0 lg:mt-6">
                <TripActions trip={trip} allowance={allowance} organizationName={organizationName} />
            </div>
        </header>
    )
}

function RouteCard({ trip }: { trip: TripDetail }) {
    const t = useTranslations("App.trips")

    return (
        <Card title={t("detail.route")}>
            <div className="flex flex-col gap-1.5 text-sm">
                <span>{trip.origin.address}</span>
                <span className="text-muted-foreground flex items-center gap-1.5">
                    <IconArrowNarrowRight className="size-4 shrink-0" stroke={1.5} />
                    {trip.destination.address}
                </span>
            </div>

            <TripRouteMap tripId={trip.id} status={trip.status} className="h-72 overflow-hidden rounded-xl" />
        </Card>
    )
}

function PingsCard({ trip }: { trip: TripDetail }) {
    const t = useTranslations("App.trips")
    const f = useFormatter()
    const trpc = useTRPC()

    // The same polling query the map draws from, so the list and the line
    // can never show a different last position
    const { data: points } = useSuspenseQuery(
        trpc.trips.trail.queryOptions({ id: trip.id }, { refetchInterval: TRAIL_POLL_MS }),
    )

    return (
        <Card title={t("detail.pings")} count={points.length}>
            <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3">
                <span className="text-muted-foreground text-[13px]">{t("panel.fields.last-ping")}</span>
                <LastPingCell ping={trip.lastPing} />
            </div>

            {points.length === 0 ? (
                <EmptyValue label={t("detail.no-pings")} />
            ) : (
                <ol className="flex flex-col gap-2">
                    {[...points].reverse().map((point) => (
                        <li key={point.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                            <span className="min-w-0 truncate">
                                {point.placeName ?? t("detail.unnamed-place")}
                            </span>
                            <span className="text-muted-foreground shrink-0 tabular-nums">
                                {f.dateTime(point.recordedAt, {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    )
}

function RequestsCard({ requests }: { requests: TripRequestView[] }) {
    const t = useTranslations("App.trips")
    const f = useFormatter()

    return (
        <Card title={t("detail.requests")}>
            <p className="text-muted-foreground text-xs">{t("detail.requests-hint")}</p>

            {requests.length === 0 ? (
                <EmptyValue label={t("detail.no-requests")} />
            ) : (
                <ol className="flex flex-col gap-2">
                    {requests.map((request) => (
                        <li key={request.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                            <span className="min-w-0 truncate">
                                {t("detail.request-line", {
                                    slot: t(`slot.${request.slot}`),
                                    attempt: request.attempt,
                                    channel: t(`channel.${request.channel}`),
                                })}
                            </span>
                            <span className="text-muted-foreground shrink-0">
                                {t(`requestStatus.${request.status}`)}
                                {" · "}
                                {f.dateTime(request.createdAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    )
}

/**
 * A block on the trip page — the same ring-and-radius surface as the list
 * card and the order page's sections, so the page reads as part of one
 * system.
 */
function Card({
    title,
    count,
    className,
    children,
}: {
    title: string
    count?: number
    className?: string
    children: React.ReactNode
}) {
    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <header className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-[13px] font-medium">
                    {title}
                    {count !== undefined && (
                        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums">
                            {count}
                        </span>
                    )}
                </h2>
            </header>

            {children}
        </section>
    )
}

/** The eyebrow tells the reader which list this trip came from. */
const sectionFor = (trip: TripDetail) =>
    trip.status === "cancelled" ? "history" : trip.status
