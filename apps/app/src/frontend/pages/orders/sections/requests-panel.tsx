"use client"

import { useState } from "react"
import { IconSend, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { initials } from "@workspace/ui/customs/list/table-cells"
import { RequestStatusChip } from "@/frontend/pages/orders/components/badges"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { SendRequestsDialog } from "@/frontend/pages/orders/sections/send-requests-dialog"
import type { OrderDetail, OrgType } from "@/frontend/pages/orders/types"

/** A request the client can still take back; a quote already made survives it. */
const LIVE: string[] = ["requested", "quoted"]

/**
 * The request round. A client sees every carrier it asked and how each one
 * answered, and can ask more of them while the order is still a prospect; a
 * carrier sees only its own request, with whatever the client wrote to it.
 */
export function RequestsPanel({ order, orgType }: { order: OrderDetail; orgType: OrgType }) {
    const t = useTranslations("App.orders.requests")
    const f = useFormatter()

    const [sendOpen, setSendOpen] = useState(false)

    const { withdrawRequest } = useOrderMutations()

    const prospect = order.status === "prospect"
    const canSend = orgType === "shipper" && prospect && order.permissions.isMine

    return (
        <>
            <SectionCard
                title={t("title")}
                count={order.requests.length}
                actions={canSend ? (
                    <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
                        <IconSend />
                        {t("actions.send")}
                    </Button>
                ) : undefined}
            >
                {order.requests.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-sm">
                        {t(orgType === "carrier" ? "empty.carrier" : "empty.shipper")}
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y">
                        {order.requests.map((request) => (
                            <li key={request.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                                <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                    {initials(request.carrierName)}
                                </span>

                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="truncate text-sm font-medium">{request.carrierName}</span>
                                        <RequestStatusChip status={request.status} />
                                    </div>

                                    {request.message && (
                                        <p className="text-muted-foreground text-xs">{request.message}</p>
                                    )}

                                    <p className="text-muted-foreground/70 text-xs">
                                        {t("sent-on", { date: f.dateTime(request.createdAt, { dateStyle: "medium" }) })}
                                    </p>
                                </div>

                                {canSend && LIVE.includes(request.status) && (
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={t("actions.withdraw")}
                                        disabled={withdrawRequest.isPending}
                                        onClick={() => withdrawRequest.mutate({
                                            orderId: order.orderId,
                                            carrierOrgId: request.carrierId,
                                        })}
                                    >
                                        <IconX />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            {canSend && (
                <SendRequestsDialog
                    orderId={order.orderId}
                    alreadyRequested={order.requests.filter((request) => LIVE.includes(request.status)).map((request) => request.carrierId)}
                    open={sendOpen}
                    onOpenChange={setSendOpen}
                />
            )}
        </>
    )
}
