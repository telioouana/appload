"use client"

import { useMemo } from "react"
import { IconClockExclamation } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { isSilent, seenAt } from "@/frontend/pages/dashboard/types"
import type { MapOrder } from "@/frontend/pages/map/types"

/**
 * The rail beside the fleet map: every truck on the road, freshest ping
 * first, the ones that have gone quiet calling themselves out in amber.
 *
 * Deliberately thinner than the map page's list — no search, no badge, no
 * ping count. At 16rem the row has to say three things and no more: which
 * load it is, who is driving it, and when we last heard from it. Clicking a
 * row is the same act as clicking its pin, so both go through `onSelect`.
 */
export function FleetList({
    orders,
    selected,
    onSelect,
    now,
}: {
    orders: MapOrder[]
    selected: string | null
    onSelect: (orderId: string) => void
    /** Ticked by the card, so every relative label moves together and none warns */
    now: Date
}) {
    const t = useTranslations("Admin.dashboard")
    const f = useFormatter()

    // Newest ping first; a load that has never pinged scores 0 and sinks to
    // the bottom — the same order the map page's list uses.
    const sorted = useMemo(() => [...orders].sort((a, b) => seenAt(b) - seenAt(a)), [orders])

    const nowMs = now.getTime()

    return (
        <div className="container-snap flex max-h-56 flex-col gap-0.5 overflow-y-auto lg:h-[420px] lg:max-h-none">
            {sorted.map((order) => {
                const isOpen = order.orderId === selected
                const silent = isSilent(order, nowMs)

                // Null only for a load that has never pinged, which is silent
                // by definition — so the fresh branch below always has a label
                const ago = order.lastLocation ? f.relativeTime(order.lastLocation.recordedAt, now) : null

                return (
                    <button
                        key={order.orderId}
                        type="button"
                        onClick={() => onSelect(order.orderId)}
                        className={cn(
                            "hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-l-2 border-transparent px-2.5 py-2 text-left transition-colors",
                            isOpen && "border-primary bg-accent/10",
                        )}
                    >
                        {/* Same token the pin paints itself with, so a row and
                            its truck can never disagree about a status */}
                        <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: `var(--status-${order.status}-text)` }}
                        />

                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-mono text-[13px] font-medium">{order.orderId}</span>
                            <span className="text-muted-foreground truncate text-[11px]">
                                {[order.driverName, order.truckPlate].filter(Boolean).join(" · ") || "—"}
                            </span>
                        </span>

                        {silent ? (
                            <span className="flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-amber-600 dark:text-amber-400">
                                <IconClockExclamation className="size-3.5" stroke={1.5} />
                                {ago ? t("fleet.silent", { ago }) : t("fleet.no-location")}
                            </span>
                        ) : (
                            <span className="text-muted-foreground shrink-0 text-[11px] whitespace-nowrap">
                                {ago && t("fleet.last-seen", { ago })}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}
