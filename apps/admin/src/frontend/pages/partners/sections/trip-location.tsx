"use client"

import { IconMapPin } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { EmptyValue } from "@/components/list/labeled-field"
import type { TripSummary } from "@/frontend/pages/partners/types"

/**
 * Where a rig or driver is, as far as the order table knows.
 *
 * This is inferred from the shipment's status, not from telemetry, so the
 * wording commits only to a direction — never "is at X". With no active
 * shipment it reads "idle" rather than showing a stale last-known position.
 *
 * `variant="route"` renders the leg as origin over destination with a green
 * and a red dot; `variant="line"` collapses it to one line for the tighter
 * driver row.
 */
export function TripLocation({
    trip,
    variant = "line",
}: {
    trip: TripSummary | null
    variant?: "line" | "route"
}) {
    const t = useTranslations("Admin.partners.values")

    if (!trip || (!trip.from && !trip.to)) {
        return <EmptyValue label={t("idle")} />
    }

    if (variant === "route") {
        return (
            <div className="flex min-w-0 flex-col gap-1">
                <Leg city={trip.from} tone="origin" />
                <Leg city={trip.to} tone="destination" />
            </div>
        )
    }

    // The city the rig is heading for is the useful one mid-trip; before
    // loading it is still the pickup
    const city = trip.inTransit ? trip.to : trip.from

    return (
        <span className="inline-flex min-w-0 items-center gap-1">
            <IconMapPin className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
            <span className="truncate">
                {trip.inTransit ? t("en-route", { city: city ?? "" }) : t("at", { city: city ?? "" })}
            </span>
        </span>
    )
}

function Leg({ city, tone }: { city: string | null; tone: "origin" | "destination" }) {
    if (!city) return null

    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{
                    backgroundColor: tone === "origin"
                        ? "var(--status-verified-text)"
                        : "var(--status-rejected-text)",
                }}
            />
            <span className="truncate text-sm">{city}</span>
        </span>
    )
}
