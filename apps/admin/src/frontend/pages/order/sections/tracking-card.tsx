"use client"

import { IconMap2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"
import type { Order } from "@workspace/db/orders"

import { OrderRouteMapLazy } from "@/frontend/pages/map/components/order-route-map.lazy"

import { SectionCard } from "./section-card"

/**
 * The trip on a map: the planned road route in grey, the ground the driver
 * has actually covered in orange, and where they were last seen.
 *
 * The map owns its own empty, unavailable and unconfigured states — this
 * only frames it and offers the way through to the full map page.
 *
 * From `lg` up the card is as tall as the rail and the canvas takes whatever
 * the header leaves; below that the page scrolls, so the map keeps a fixed
 * height instead of collapsing to nothing.
 */
export function TrackingCard({ order }: { order: Order }) {
    const t = useTranslations("Admin.orders.detailPage")

    return (
        <SectionCard
            className="lg:h-full"
            title={t("sections.tracking")}
            actions={
                <Link
                    href={{ pathname: "/map", query: { order: order.orderId } }}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
                >
                    <IconMap2 className="size-3.5" stroke={1.5} />
                    {t("openMap")}
                </Link>
            }
        >
            <OrderRouteMapLazy
                orderId={order.orderId}
                status={order.status}
                className="h-56 w-full overflow-hidden rounded-xl lg:h-auto lg:min-h-0 lg:flex-1"
            />
        </SectionCard>
    )
}
