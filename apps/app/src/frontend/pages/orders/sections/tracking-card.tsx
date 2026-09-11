"use client"

import { IconMap2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Link } from "@/i18n/navigation"
import { OrderRouteMapLazy } from "@/frontend/pages/map/components/order-route-map.lazy"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import type { OrderDetail, OrderStatus } from "@/frontend/pages/orders/types"

/** Nothing is driving yet, or nothing ever will: neither has a route worth buying. */
const WITHOUT_TRACKING: OrderStatus[] = ["prospect", "cancelled", "underbid"]

/**
 * The trip on a map: the planned road route in grey, the ground the driver
 * has actually covered in orange, and where they were last seen.
 *
 * The map owns its own empty, unavailable and unconfigured states — this
 * only frames it and offers the way through to the full map page.
 *
 * It appears once the order is booked, and only for the two parties to it:
 * a carrier that quoted and lost reads the row but not where the truck that
 * won it is, and the server refuses that query outright.
 */
export function TrackingCard({ order }: { order: OrderDetail }) {
    const t = useTranslations("App.orders.tracking")

    if (!order.permissions.isMine || WITHOUT_TRACKING.includes(order.status)) {
        return null
    }

    return (
        <SectionCard
            title={t("title")}
            actions={
                <Link
                    href={{ pathname: "/map", query: { id: order.orderId } }}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
                >
                    <IconMap2 className="size-3.5" stroke={1.5} />
                    {t("open-map")}
                </Link>
            }
        >
            <OrderRouteMapLazy
                orderId={order.orderId}
                status={order.status}
                className="h-56 w-full overflow-hidden rounded-xl"
            />
        </SectionCard>
    )
}
