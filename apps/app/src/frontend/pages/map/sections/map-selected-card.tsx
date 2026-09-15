"use client"

import { IconExternalLink, IconX } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { OrderStatusBadge } from "@/frontend/pages/orders/components/badges"
import { place } from "@/frontend/pages/orders/lib/format"
import type { MapEntity } from "@/frontend/pages/map/types"

/**
 * The open pin's details, over the map: where the load is going, who is
 * driving it, when it was last seen, and the way through to the page that
 * owns it — the order, or the standalone trip.
 */
export function MapSelectedCard({
    entity,
    onClose,
    className,
}: {
    entity: MapEntity
    onClose: () => void
    className?: string
}) {
    const t = useTranslations("App.map.selected")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })

    return (
        <div className={cn("bg-popover text-popover-foreground flex flex-col gap-3 rounded-2xl border p-4 shadow-lg", className)}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-semibold">{entity.ref}</span>
                    <OrderStatusBadge status={entity.status} className="w-fit px-1.5 py-0.5 text-xs" />
                </div>

                <Button size="icon-xs" variant="ghost" aria-label={t("close")} onClick={onClose}>
                    <IconX className="size-4" stroke={1.5} />
                </Button>
            </div>

            <div className="flex flex-col gap-1 text-xs">
                <p className="truncate font-medium">
                    {place(entity.origin)} → {place(entity.destination)}
                </p>

                <p className="text-muted-foreground truncate">
                    {[entity.driverName, entity.truckPlate].filter(Boolean).join(" · ") || "—"}
                </p>

                {entity.counterpartyName && (
                    <p className="text-muted-foreground truncate">{entity.counterpartyName}</p>
                )}

                <p className="text-muted-foreground">
                    {entity.lastPosition
                        ? t("last-seen", { ago: f.relativeTime(entity.lastPosition.recordedAt, now) })
                        : t("no-pings")}
                </p>
            </div>

            <Button size="sm" variant="outline" className="w-fit" asChild>
                <Link href={entity.href}>
                    <IconExternalLink className="size-4" stroke={1.5} />
                    {t(`open.${entity.kind}`)}
                </Link>
            </Button>
        </div>
    )
}
