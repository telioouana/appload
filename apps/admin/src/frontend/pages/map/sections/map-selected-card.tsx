"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink, IconMapPinShare, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@workspace/trpc/errors"
import { useOrderSheet } from "@/frontend/pages/orders/hooks/use-order-sheet"
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"
import type { MapOrder } from "@/frontend/pages/map/types"

// Same failures the chat composer surfaces — it is the same send
const LOCATION_ERROR_KEYS = {
    NO_ACTIVE_ORDER: "noActiveOrder",
    SEND_FAILED: "sendFailed",
    UNKNOWN: "unknown",
} as const
const LOCATION_ERROR_CODES = Object.keys(LOCATION_ERROR_KEYS) as (keyof typeof LOCATION_ERROR_KEYS)[]

/**
 * The open pin's details, over the map: where the load is going, who is
 * driving it, when it was last seen, and the three things an operator does
 * next — read it, open it in full, or ask the driver where he is.
 */
export function MapSelectedCard({
    order,
    onClose,
    className,
}: {
    order: MapOrder
    onClose: () => void
    className?: string
}) {
    const t = useTranslations("Admin.map.selected")
    const c = useTranslations("Admin.messages.thread.location")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })

    const trpc = useTRPC()
    const { open } = useOrderSheet()

    // The card stays open after the send, so the button has to say what
    // happened once the toast is gone
    const [isRequested, setRequested] = useState(false)

    const requestLocation = useMutation(trpc.chats.requestLocation.mutationOptions())

    const onRequestLocation = () => {
        if (!order.conversationId || requestLocation.isPending) return

        requestLocation.mutate(
            { conversationId: order.conversationId },
            {
                onSuccess: (result) => {
                    setRequested(true)
                    toast.success(result.mode === "native" ? c("sentNative") : c("sentTemplate"))
                },
                onError: (error) => {
                    const code = domainErrorCode(error, LOCATION_ERROR_CODES, "UNKNOWN")
                    toast.error(c(`errors.${LOCATION_ERROR_KEYS[code]}`))
                },
            },
        )
    }

    return (
        <div className={cn("bg-popover text-popover-foreground flex flex-col gap-3 rounded-2xl border p-4 shadow-lg", className)}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-semibold">{order.orderId}</span>
                    <OrderStatusBadge status={order.status} className="w-fit px-1.5 py-0.5 text-xs" />
                </div>

                <Button size="icon-xs" variant="ghost" aria-label={t("close")} onClick={onClose}>
                    <IconX className="size-4" stroke={1.5} />
                </Button>
            </div>

            <div className="flex flex-col gap-1 text-xs">
                <p className="truncate font-medium">
                    {place(order.loadingAddress)} → {place(order.offloadingAddress)}
                </p>

                <p className="text-muted-foreground truncate">
                    {[order.driverName, order.truckPlate].filter(Boolean).join(" · ") || "—"}
                </p>

                <p className="text-muted-foreground truncate">
                    {[order.shipperName, order.carrierName].filter(Boolean).join(" / ")}
                </p>

                <p className="text-muted-foreground">
                    {order.lastLocation
                        ? t("last-seen", { ago: f.relativeTime(order.lastLocation.recordedAt, now) })
                        : t("no-pings")}
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => open(order.orderId)}>
                    {t("open")}
                </Button>

                <Button size="sm" variant="outline" asChild>
                    <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } }}>
                        <IconExternalLink className="size-4" stroke={1.5} />
                        {t("full-page")}
                    </Link>
                </Button>

                {order.conversationId && (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={requestLocation.isPending || isRequested}
                        onClick={onRequestLocation}
                    >
                        <IconMapPinShare className="size-4" stroke={1.5} />
                        {isRequested ? t("requested") : t("request-location")}
                    </Button>
                )}
            </div>
        </div>
    )
}
