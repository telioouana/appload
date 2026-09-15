"use client"

import { IconArrowNarrowRight, IconShieldHalf, IconSatellite } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import type { Currency, Location, QuoteStatus } from "@/frontend/pages/quotes/types"

/**
 * Where the quote stands. Plain chips rather than the order StatusBadge: a
 * quote's five states are not order statuses and have no colour tokens of
 * their own, so the accepted one carries the emphasis and the rest read as
 * history.
 */
export function QuoteStatusChip({ status }: { status: QuoteStatus }) {
    const t = useTranslations("App.quotes.status")

    return (
        <Badge
            variant={status === "accepted" ? "default" : status === "sent" ? "secondary" : "outline"}
            className="rounded-full font-normal"
        >
            {t(status)}
        </Badge>
    )
}

/** What the price already covers: goods-in-transit cover and live tracking. */
export function CoverChips({ includesGit, includesGps }: { includesGit: boolean; includesGps: boolean }) {
    const t = useTranslations("App.quotes.cover")

    if (!includesGit && !includesGps) return <EmptyValue label={t("none")} />

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {includesGit && (
                <Badge variant="outline" className="gap-1 rounded-full font-normal">
                    <IconShieldHalf className="size-3.5" stroke={1.5} />
                    {t("git")}
                </Badge>
            )}
            {includesGps && (
                <Badge variant="outline" className="gap-1 rounded-full font-normal">
                    <IconSatellite className="size-3.5" stroke={1.5} />
                    {t("gps")}
                </Badge>
            )}
        </div>
    )
}

/** The lane, on two lines: where it loads, where it offloads. */
export function LaneCell({ origin, destination }: { origin: Location; destination: Location }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px]">{origin.address}</span>
            <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-xs">
                <IconArrowNarrowRight className="size-3.5 shrink-0" stroke={1.5} />
                <span className="truncate">{destination.address}</span>
            </span>
        </div>
    )
}

/**
 * Single place where a quoted amount becomes a string. Intl ignores
 * `currency` unless `style: "currency"` is set, so the code is appended
 * explicitly — change it here and every view follows.
 */
export function useMoney() {
    const f = useFormatter()

    return (amount: number | null | undefined, currency: Currency) =>
        `${f.number(Number(amount ?? 0), { maximumFractionDigits: 2 })} ${currency}`
}
