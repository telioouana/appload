"use client"

import { useQuery } from "@tanstack/react-query"
import { IconArrowNarrowRight, IconExternalLink } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { EmptyValue } from "@/components/list/empty-value"
import { LastPingCell, TripStatusChip } from "@/frontend/pages/trips/components/badges"
import { TripActions } from "@/frontend/pages/trips/sections/trip-actions"
import { useTripSheet } from "@/frontend/pages/trips/hooks/use-trip-sheet"
import type { TripDetail } from "@/frontend/pages/trips/types"

/**
 * The trip panel the page mounts once. Which trip it shows comes from the
 * URL, so a row click and a shared link open the same thing.
 *
 * What it offers comes from the server's own `permissions`, not from a rule
 * restated here: the buttons can only ever be the moves the mutations accept.
 */
export function TripSheet({
    allowance,
    organizationName,
}: {
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.trips.panel")
    const { id, close } = useTripSheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[560px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && (
                    <Panel
                        key={id}
                        id={id}
                        allowance={allowance}
                        organizationName={organizationName}
                        onClose={close}
                    />
                )}
            </SheetContent>
        </Sheet>
    )
}

function Panel({
    id,
    allowance,
    organizationName,
    onClose,
}: {
    id: string
    allowance: TrackingAllowance
    organizationName: string
    onClose: () => void
}) {
    const t = useTranslations("App.trips")
    const trpc = useTRPC()

    const { data, isPending, isError } = useQuery(trpc.trips.get.queryOptions({ id }))

    if (isPending) {
        return (
            <div className="flex flex-col gap-4 p-6">
                <Skeleton className="h-6 w-40 rounded-md" />
                <Skeleton className="h-4 w-64 rounded-md" />
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
        )
    }

    if (isError || !data) {
        return <p className="text-destructive p-6 text-sm">{t("panel.error")}</p>
    }

    return (
        <Loaded
            trip={data}
            allowance={allowance}
            organizationName={organizationName}
            onClose={onClose}
        />
    )
}

function Loaded({
    trip,
    allowance,
    organizationName,
    onClose,
}: {
    trip: TripDetail
    allowance: TrackingAllowance
    organizationName: string
    onClose: () => void
}) {
    const t = useTranslations("App.trips")
    const f = useFormatter()

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-4">
                <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-heading truncate text-xl font-semibold tracking-tight">{trip.ref}</h2>
                    <TripStatusChip status={trip.status} />
                </div>

                <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                    <span className="truncate">{trip.driverName}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{trip.driverPhone}</span>
                    {trip.truckPlate && (
                        <>
                            <span aria-hidden>·</span>
                            <span className="truncate">{trip.truckPlate}</span>
                        </>
                    )}
                </p>
            </div>

            <Separator />

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-6">
                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.lane")}</SectionTitle>

                        <div className="flex flex-col gap-1.5 text-sm">
                            <span>{trip.origin.address}</span>
                            <span className="text-muted-foreground flex items-center gap-1.5">
                                <IconArrowNarrowRight className="size-4 shrink-0" stroke={1.5} />
                                {trip.destination.address}
                            </span>
                        </div>

                        <dl className="mt-2 flex flex-col gap-2">
                            <Line
                                label={t("panel.fields.partner")}
                                value={trip.counterpartyName}
                                empty={t("values.own-load")}
                            />
                            <Line
                                label={t("panel.fields.cargo")}
                                value={trip.cargoDescription}
                                empty={t("values.not-stated")}
                            />
                        </dl>
                    </section>

                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.tracking")}</SectionTitle>

                        <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3">
                            <span className="text-muted-foreground text-[13px]">{t("panel.fields.last-ping")}</span>
                            <LastPingCell ping={trip.lastPing} />
                        </div>

                        <dl className="flex flex-col gap-2">
                            <Line
                                label={t("panel.fields.pings")}
                                value={f.number(trip.pingCount)}
                            />
                            <Line
                                label={t("panel.fields.started")}
                                value={trip.startedAt ? f.dateTime(trip.startedAt, { dateStyle: "medium", timeStyle: "short" }) : null}
                                empty={t("values.not-started")}
                            />
                            <Line
                                label={t("panel.fields.expected")}
                                value={trip.expectedDeliveryAt ? f.dateTime(trip.expectedDeliveryAt, { dateStyle: "long" }) : null}
                                empty={t("values.no-due-date")}
                            />
                            <Line
                                label={t("panel.fields.delivered")}
                                value={trip.deliveredAt ? f.dateTime(trip.deliveredAt, { dateStyle: "medium", timeStyle: "short" }) : null}
                                empty={t("values.pending")}
                            />
                        </dl>
                    </section>

                    <Button asChild variant="outline" size="sm" className="w-fit">
                        <Link href={{ pathname: "/trips/[tripId]", params: { tripId: trip.id } }}>
                            <IconExternalLink className="size-4" stroke={1.5} />
                            {t("panel.open")}
                        </Link>
                    </Button>
                </div>
            </div>

            {trip.permissions.isMine && (
                <>
                    <Separator />

                    <div className="px-6 py-4">
                        <TripActions
                            trip={trip}
                            allowance={allowance}
                            organizationName={organizationName}
                            onClosed={onClose}
                        />
                    </div>
                </>
            )}
        </div>
    )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{children}</h3>
}

/** One label/value line; a missing value says so rather than leaving a blank. */
function Line({
    label,
    value,
    empty,
}: {
    label: string
    value: string | null
    empty?: string
}) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
            <dd className="text-right text-sm">{value ?? <EmptyValue label={empty ?? "—"} />}</dd>
        </div>
    )
}
