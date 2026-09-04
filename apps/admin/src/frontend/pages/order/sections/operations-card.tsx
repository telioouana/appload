"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { CopyButton } from "@/frontend/pages/partners/sections/profile-parts"
import { OperationsStrip } from "@/frontend/pages/orders/sections/order-item-parts"

import { OpenChatButton } from "./open-chat-button"
import { SectionCard, StatTile } from "./section-card"

/**
 * Who is driving and in what, over the four figures the trip is judged on.
 * The strip keeps its own "no driver assigned" line, and the tiles stay
 * either way — an order with nothing assigned still has a distance.
 */
export function OperationsCard({ order }: { order: Order }) {
    const t = useTranslations("Admin.orders.detailPage")
    const tActions = useTranslations("Admin.partners.actions")
    const f = useFormatter()

    const phone = order.driverPhoneNumber

    return (
        <SectionCard title={t("sections.operations")} aside={order.carrierName ?? undefined}>
            <OperationsStrip
                order={order}
                phoneAction={phone ? (
                    <span className="flex shrink-0 items-center gap-1">
                        <CopyButton value={phone} label={tActions("copy-phone")} />
                        <OpenChatButton
                            driverName={order.driverName}
                            driverPhone={phone}
                            orderId={order.orderId}
                            status={order.status}
                        />
                    </span>
                ) : undefined}
            />

            <div className="grid grid-cols-2 gap-3 border-t pt-3.5 sm:grid-cols-4">
                <StatTile
                    value={order.distance !== null ? `${f.number(order.distance)} km` : <Dash />}
                    label={t("metrics.distance")}
                />
                <StatTile value={order.deliveries ?? <Dash />} label={t("metrics.deliveries")} />
                <StatTile value={order.daysSpendTraveling ?? <Dash />} label={t("metrics.daysTraveling")} />
                <StatTile
                    value={order.podStatus
                        ? <span className="text-base">{t(`pod.${order.podStatus}`)}</span>
                        : <Dash />}
                    label={t("metrics.podStatus")}
                />
            </div>
        </SectionCard>
    )
}

function Dash() {
    return <span className="text-muted-foreground/60">—</span>
}
