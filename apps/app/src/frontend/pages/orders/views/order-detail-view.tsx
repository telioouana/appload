"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { orderMilestones } from "@/frontend/pages/orders/lib/milestones"
import { MilestoneRail } from "@/frontend/pages/orders/components/milestone-rail"
import { OrderDetailHeader } from "@/frontend/pages/orders/sections/detail-header"
import { DocumentsCard } from "@/frontend/pages/orders/sections/documents-card"
import { LoadingCheckCard, showsLoadingCheck } from "@/frontend/pages/orders/sections/loading-check-card"
import { OffersPanel } from "@/frontend/pages/orders/sections/offers-panel"
import { OperationsCard } from "@/frontend/pages/orders/sections/operations-card"
import { RequestsPanel } from "@/frontend/pages/orders/sections/requests-panel"
import { MoneyCard, RouteCargoCard } from "@/frontend/pages/orders/sections/route-cargo-card"
import { TimelineCard } from "@/frontend/pages/orders/sections/timeline-card"
import { TrackingCard } from "@/frontend/pages/orders/sections/tracking-card"
import { ChatCard } from "@/frontend/pages/threads/sections/chat-card"

/**
 * One order on one page: where the trip is, what it is carrying, what it is
 * worth to the reader, who quoted for it, who is driving it, what is
 * attached and what has happened. This file owns the queries and hands each
 * block what it renders; every permission on it was decided by the server.
 */
export function OrderDetailView({ orderId }: { orderId: string }) {
    const t = useTranslations("App.orders.detail")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: order } = useSuspenseQuery(trpc.orders.get.queryOptions({ orderId }))
    const { data: history } = useSuspenseQuery(trpc.orders.history.queryOptions({ orderId }))
    const { data: options } = useSuspenseQuery(trpc.orders.transitionOptions.queryOptions({ orderId }))

    const orgType = session.organization.type

    const steps = orderMilestones(order, history)

    return (
        <>
            <OrderDetailHeader
                order={order}
                orgType={orgType}
                organizationName={session.organization.name}
                options={options}
            />

            <div className="shrink-0 px-2">
                <MilestoneRail steps={steps} />
            </div>

            {/* From lg up the page itself does not scroll: the left column
                does, so the timeline on the right stays where it was. Below
                lg it is one column and the page scrolls instead. */}
            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]">
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <RouteCargoCard order={order} />

                    <OffersPanel
                        order={order}
                        orgType={orgType}
                        allowance={session.allowance}
                        organizationName={session.organization.name}
                    />

                    <RequestsPanel order={order} orgType={orgType} />

                    <OperationsCard order={order} />

                    {/* What the truck was dispatched with, and the client's
                        confirmation at the loading site. The card itself
                        renders nothing when there is neither. */}
                    {showsLoadingCheck(order.status) && <LoadingCheckCard order={order} />}

                    <DocumentsCard order={order} orgType={orgType} />

                    <p className="text-muted-foreground px-1 text-xs">
                        {t("footer", {
                            created: f.dateTime(order.createdAt, { dateStyle: "medium" }),
                            updated: f.dateTime(order.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                        })}
                    </p>
                </div>

                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <TrackingCard order={order} />

                    {/* The shipper, Appload and — once it holds the job — the
                        carrier. A company that only quoted is not a party, and
                        the card renders nothing for it */}
                    <ChatCard subjectType="order" subjectId={orderId} />

                    {/* Only the two parties to the deal have a leg to show:
                        a carrier that quoted and lost is given no figures */}
                    {order.permissions.isMine && <MoneyCard order={order} />}

                    <TimelineCard entries={history} />
                </div>
            </div>
        </>
    )
}
