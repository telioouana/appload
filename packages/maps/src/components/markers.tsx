"use client"

import { IconFlagCheck, IconMapPin } from "@tabler/icons-react"
import { AdvancedMarker } from "@vis.gl/react-google-maps"

import type { OrderStatus } from "@workspace/db/types"
import { statusIcons } from "@workspace/ui/customs/badge/status-badge"
import { cn } from "@workspace/ui/lib/utils"

import { COVERED_ORANGE } from "@workspace/maps/lib/colors"
import type { LatLng } from "@workspace/maps/types"

/**
 * The three things we drop on the map: the two ends of a route, the pings
 * behind the truck, and the truck itself.
 *
 * All of them are `AdvancedMarker`s with plain React children, so they are
 * styled with the same tokens as the rest of the admin — the status pin reads
 * `--status-<status>-bg/-text` straight off `:root`/`.dark`, exactly like
 * `StatusBadge` does, which is why a pin can never drift from its badge.
 *
 * Every content element sets `pointerEvents: "auto"`. vis.gl puts
 * `pointer-events: none` on the marker content of anything it considers
 * non-clickable, which would make the `title` tooltips unreachable — a child
 * may take pointer targeting back, and these do.
 */

/** Where a load starts (grey) and where it ends (emerald). */
export function StopMarker({ position, kind, title }: { position: LatLng; kind: "loading" | "offloading"; title?: string }) {
    const Icon = kind === "loading" ? IconMapPin : IconFlagCheck

    return (
        <AdvancedMarker position={position} title={title} zIndex={4}>
            <div
                title={title}
                style={{ pointerEvents: "auto" }}
                className={cn(
                    "flex size-6 items-center justify-center rounded-full border-2 border-white text-white shadow-md",
                    kind === "loading" ? "bg-zinc-500" : "bg-emerald-600",
                )}
            >
                <Icon size={13} />
            </div>
        </AdvancedMarker>
    )
}

/** One historical location update. The truck itself is a StatusPin, not one of these. */
export function PingDot({ position, title }: { position: LatLng; title?: string }) {
    return (
        <AdvancedMarker position={position} title={title} zIndex={5}>
            {/* The marker anchors its content by the bottom edge; nudging down by
                half the height puts the centre of the dot on the coordinate. */}
            <div style={{ transform: "translateY(50%)", pointerEvents: "auto" }}>
                <div
                    title={title}
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: "9999px",
                        background: COVERED_ORANGE,
                        border: "2px solid #FFFFFF",
                        boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.15)",
                    }}
                />
            </div>
        </AdvancedMarker>
    )
}

type StatusPinProps = {
    position: LatLng
    status: OrderStatus
    /** Shown under the pin when `emphasis` is "match", as a tooltip otherwise. */
    label?: string
    /** "match" = a search hit, "dim" = filtered out, "normal" = everything else. */
    emphasis?: "normal" | "match" | "dim"
    selected?: boolean
    onClick?: () => void
    zIndex?: number
}

/**
 * A truck, drawn as its order status. Search results grow and keep their label
 * on screen; everything else fades back and only names itself on hover.
 */
export function StatusPin({ position, status, label, emphasis = "normal", selected = false, onClick, zIndex = 6 }: StatusPinProps) {
    const match = emphasis === "match"

    return (
        <AdvancedMarker
            position={position}
            title={label}
            clickable={Boolean(onClick)}
            onClick={onClick ? () => onClick() : undefined}
            zIndex={match ? 1000 : zIndex}
        >
            <div
                title={label}
                style={{ pointerEvents: "auto" }}
                className={cn(
                    "relative flex flex-col items-center transition-[transform,opacity] duration-150",
                    onClick && "cursor-pointer",
                    match && "scale-125",
                    emphasis === "dim" && "opacity-35",
                )}
            >
                <div
                    className="flex items-center justify-center rounded-full [&_svg]:size-4"
                    style={{
                        width: 28,
                        height: 28,
                        background: `var(--status-${status}-bg)`,
                        color: `var(--status-${status}-text)`,
                        borderColor: `var(--status-${status}-text)`,
                        borderWidth: 2,
                        borderStyle: "solid",
                        boxShadow: selected
                            ? "0 0 0 2px var(--primary), 0 1px 3px rgba(0, 0, 0, 0.25)"
                            : "0 1px 3px rgba(0, 0, 0, 0.25)",
                    }}
                >
                    {statusIcons[status]}
                </div>

                {match && label ? (
                    <span className="mt-1 whitespace-nowrap rounded-md border bg-popover px-1.5 text-[11px] font-medium text-popover-foreground shadow">
                        {label}
                    </span>
                ) : null}
            </div>
        </AdvancedMarker>
    )
}
