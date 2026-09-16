"use client"

import { Suspense } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { useTRPC } from "@/backend/api/client"
import { DocumentsCard as OrderDocumentsCard } from "@/frontend/pages/orders/sections/documents-card"
import { LoadingCheckCard, showsLoadingCheck } from "@/frontend/pages/orders/sections/loading-check-card"
import { OffersPanel } from "@/frontend/pages/orders/sections/offers-panel"
import { OperationsCard } from "@/frontend/pages/orders/sections/operations-card"
import { RequestsPanel } from "@/frontend/pages/orders/sections/requests-panel"
import { TimelineCard as OrderTimelineCard } from "@/frontend/pages/orders/sections/timeline-card"
import { TrackingCard as OrderTrackingCard } from "@/frontend/pages/orders/sections/tracking-card"
import { TransitionBar } from "@/frontend/pages/orders/sections/transition-bar"
import { ChatCard } from "@/frontend/pages/threads/sections/chat-card"
import type { OrderDetail, OrgType } from "@/frontend/pages/orders/types"

/** Which side of the Appload order the company reading the load is on. */
type ApploadSide = "orderer" | "executor" | "candidate"

type PanelsProps = {
    /** The Appload order this load follows, by its own reference (APPL021.26) */
    orderId: string
    side: ApploadSide
    /** Which of the load page's two columns is asking */
    column: "left" | "right"
}

/** The moves on, which only the company with the truck has: dispatch included. */
function Transitions({ order, organizationName }: { order: OrderDetail; organizationName: string }) {
    const trpc = useTRPC()
    const { data: options } = useSuspenseQuery(trpc.orders.transitionOptions.queryOptions({ orderId: order.orderId }))

    return <TransitionBar order={order} options={options} organizationName={organizationName} />
}

/**
 * What the two companies do about the load: the offers while Appload is still
 * pricing it, the moves on, the rig, the loading check and the papers — all
 * of them the order's, in the order's own blocks.
 */
function LeftPanels({ orderId, side }: Omit<PanelsProps, "column">) {
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: order } = useSuspenseQuery(trpc.orders.get.queryOptions({ orderId }))

    // Which side of THIS order the company stands on, which is what the
    // order's own blocks key on — not the kind of company it is. A
    // transporter that hands a load to Appload is the client of the order
    // that comes out of it, and the server projects it as one (`sideScope`)
    const orgType: OrgType = side === "orderer" ? "shipper" : "carrier"

    // A company still being asked has no load to run yet: what it can do is
    // quote, and the offers panel is the form
    if (side === "candidate") {
        return (
            <OffersPanel
                order={order}
                orgType={orgType}
                allowance={session.allowance}
                organizationName={session.organization.name}
            />
        )
    }

    return (
        <>
            {side === "orderer" && order.status === "prospect" && (
                <>
                    <OffersPanel
                        order={order}
                        orgType={orgType}
                        allowance={session.allowance}
                        organizationName={session.organization.name}
                    />

                    <RequestsPanel order={order} orgType={orgType} />
                </>
            )}

            {side === "executor" && (
                <Transitions order={order} organizationName={session.organization.name} />
            )}

            <OperationsCard order={order} />

            {showsLoadingCheck(order.status) && <LoadingCheckCard order={order} />}

            <OrderDocumentsCard order={order} orgType={orgType} />
        </>
    )
}

/** Where the truck is, what the parties are saying, and what has happened. */
function RightPanels({ orderId }: { orderId: string }) {
    const trpc = useTRPC()

    const { data: order } = useSuspenseQuery(trpc.orders.get.queryOptions({ orderId }))
    const { data: history } = useSuspenseQuery(trpc.orders.history.queryOptions({ orderId }))

    return (
        <>
            <OrderTrackingCard order={order} />

            {/* The shipper, Appload and — once it holds the job — the carrier.
                The driver's own WhatsApp thread stays with Appload, which is
                the company that asks him */}
            <ChatCard subjectType="order" subjectId={orderId} />

            <OrderTimelineCard entries={history} />
        </>
    )
}

/**
 * A load handed to Appload — or taken from it — is worked from the order, not
 * from the row: this is where the load page reads it. The queries live here
 * so the page itself never learns about orders, and they stream behind their
 * own boundary — the company's own side of the load paints without waiting
 * on Appload's.
 */
export function ApploadOrderPanels({ orderId, side, column }: PanelsProps) {
    return (
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-2xl" />}>
            {column === "right"
                ? <RightPanels orderId={orderId} />
                : <LeftPanels orderId={orderId} side={side} />}
        </Suspense>
    )
}
