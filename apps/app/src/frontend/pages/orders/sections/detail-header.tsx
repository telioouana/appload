"use client"

import { useState } from "react"
import { IconArrowLeft, IconCancel, IconSend } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { Link } from "@/i18n/navigation"
import { place } from "@/frontend/pages/orders/lib/format"
import { sectionForOrder } from "@/frontend/pages/orders/lib/sections"
import { OrderStatusBadge } from "@/frontend/pages/orders/components/badges"
import { CancelOrderDialog } from "@/frontend/pages/orders/sections/cancel-order-dialog"
import { SendRequestsDialog } from "@/frontend/pages/orders/sections/send-requests-dialog"
import { TransitionBar } from "@/frontend/pages/orders/sections/transition-bar"
import type { OrderDetail, OrgType, TransitionOptions } from "@/frontend/pages/orders/types"

/** A request the client can still take back; the carriers it is open with. */
const LIVE: string[] = ["requested", "quoted"]

/**
 * The top of the order page: where you are, what this order is, and the one
 * thing to do about it. The two sides get different controls — a client
 * sends the order out and can call it off, a carrier moves it along the
 * chain — and both sets come from what the server said the actor may do.
 */
export function OrderDetailHeader({
    order,
    orgType,
    organizationName,
    options,
}: {
    order: OrderDetail
    orgType: OrgType
    organizationName: string
    options: TransitionOptions
}) {
    const t = useTranslations("App.orders")
    const f = useFormatter()

    const [sendOpen, setSendOpen] = useState(false)
    const [cancelOpen, setCancelOpen] = useState(false)

    const section = sectionForOrder(order, orgType)
    const canSend = orgType === "shipper" && order.status === "prospect" && order.permissions.isMine

    return (
        <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <Button asChild size="icon" variant="outline" aria-label={t("detail.back")} className="mt-4 shrink-0">
                    <Link href={{ pathname: "/appload/[section]", params: { section } }}>
                        <IconArrowLeft className="size-4" stroke={1.5} />
                    </Link>
                </Button>

                <div className="flex min-w-0 flex-col gap-1">
                    <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span>{t("eyebrow")}</span>
                        <span aria-hidden>/</span>
                        <span className="text-foreground/70">{t(`sections.${section}`)}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{order.orderId}</h1>
                        <OrderStatusBadge status={order.status} />
                    </div>

                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="truncate">
                            {order.counterparty.name ?? t(`values.no-counterparty.${orgType}`)}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate">
                            {place(order.loadingAddress)} → {place(order.offloadingAddress)}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{t(`category.${order.category}`)}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">
                            {f.number(order.weight, { maximumFractionDigits: 1 })} {t(`weightUnit.${order.weightUnit}`)}
                        </span>
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 lg:mt-6">
                {canSend && (
                    <Button size="sm" onClick={() => setSendOpen(true)}>
                        <IconSend />
                        <span className="truncate">{t("requests.actions.send")}</span>
                    </Button>
                )}

                {order.permissions.canCancel && (
                    <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                        <IconCancel />
                        <span className="hidden sm:inline">{t("actions.cancel")}</span>
                    </Button>
                )}

                {orgType === "carrier" && order.permissions.isMine && (
                    <TransitionBar order={order} options={options} organizationName={organizationName} />
                )}
            </div>

            {canSend && (
                <SendRequestsDialog
                    orderId={order.orderId}
                    alreadyRequested={order.requests
                        .filter((request) => LIVE.includes(request.status))
                        .map((request) => request.carrierId)}
                    open={sendOpen}
                    onOpenChange={setSendOpen}
                />
            )}

            {order.permissions.canCancel && (
                <CancelOrderDialog
                    orderId={order.orderId}
                    expectedVersion={order.version}
                    open={cancelOpen}
                    onOpenChange={setCancelOpen}
                />
            )}
        </header>
    )
}
