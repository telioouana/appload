import { Suspense } from "react"
import { notFound } from "next/navigation"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { OrdersHeaderView } from "@/frontend/pages/orders/views/orders-header-view"
import { ORDER_SECTIONS, type OrderSection } from "@/frontend/pages/orders/types"

export default async function Header({ params }: { params: Promise<{ section: string }> }) {
    const { section } = await params

    if (!(ORDER_SECTIONS as readonly string[]).includes(section)) notFound()

    // The header reads the organization type (which sections exist, whether
    // orders can be filed at all) and the section counts behind the tabs
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.orders.stats.queryOptions())

    return (
        <HydrateClient>
            <Suspense fallback={<HeaderSkeleton />}>
                <OrdersHeaderView section={section as OrderSection} />
            </Suspense>
        </HydrateClient>
    )
}
