"use client"

import { IconArrowNarrowRight, IconMapPinOff } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { EmptyValue } from "@/components/list/empty-value"
import { Dash } from "@/components/list/table-cells"
import type { Location, TripPing, TripStatus } from "@/frontend/pages/trips/types"

/** How a place reads in a cell: the province, or the first line of the address. */
export const place = (location: Location) =>
    location.state || location.address.split(",")[0]?.trim() || location.address

/**
 * Where the trip is. Plain chips rather than the order StatusBadge: a trip's
 * four states are not order statuses and have no colour tokens of their own,
 * so the one on the road carries the emphasis and the rest read as history.
 */
export function TripStatusChip({ status }: { status: TripStatus }) {
    const t = useTranslations("App.trips.status")

    return (
        <Badge
            variant={status === "in-transit" ? "default" : status === "scheduled" ? "secondary" : "outline"}
            className="rounded-full font-normal"
        >
            {t(status)}
        </Badge>
    )
}

/** The lane, on one line: where it loads, where it offloads. */
export function LaneCell({ origin, destination }: { origin: Location; destination: Location }) {
    return (
        <span className="flex min-w-0 items-center gap-1 text-[13px]">
            <span className="truncate">{place(origin)}</span>
            <IconArrowNarrowRight className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
            <span className="truncate">{place(destination)}</span>
        </span>
    )
}

/** Who is driving, and on what number — the trip's only contact. */
export function DriverCell({ name, phone }: { name: string | null; phone: string | null }) {
    // Both columns are nullable on the movement row; a trip always names its
    // driver, so the dash is for the rows another part of the portal filed
    if (!name && !phone) return <Dash />

    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-medium">{name ?? "—"}</span>
            <span className="text-muted-foreground truncate font-mono text-xs">{phone ?? "—"}</span>
        </div>
    )
}

/**
 * When the driver last reported, and from where. The clock ticks once a
 * minute so a list left open does not keep claiming the last pin is fresh.
 */
export function LastPingCell({ ping }: { ping: TripPing | null }) {
    const t = useTranslations("App.trips.values")
    const f = useFormatter()
    // Explicit now keeps relativeTime warning-free and ticks every label over
    // together, once a minute
    const now = useNow({ updateInterval: 60_000 })

    if (!ping) {
        return (
            <span className="text-muted-foreground/70 flex items-center gap-1.5 text-[13px]">
                <IconMapPinOff className="size-3.5 shrink-0" stroke={1.5} />
                {t("no-pings")}
            </span>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px]">{f.relativeTime(ping.recordedAt, now)}</span>
            {ping.placeName ? (
                <span className="text-muted-foreground truncate text-xs">{ping.placeName}</span>
            ) : (
                <span className="text-muted-foreground text-xs">
                    {f.dateTime(ping.recordedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
            )}
        </div>
    )
}

/** A value that was never recorded says so rather than leaving a blank. */
export function TripDate({ value, empty }: { value: Date | null; empty: string }) {
    const f = useFormatter()

    if (!value) return <EmptyValue label={empty} />

    return <span className="text-[13px]">{f.dateTime(value, { dateStyle: "medium" })}</span>
}
