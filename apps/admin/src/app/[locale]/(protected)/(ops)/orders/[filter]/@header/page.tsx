import { notFound } from "next/navigation"

import { isSection } from "@/frontend/pages/orders/types"
import { OrdersHeaderView } from "@/frontend/pages/orders/views/orders-header-view"

export default async function Header({ params }: { params: Promise<{ filter: string }> }) {
    const { filter } = await params

    if (!isSection(filter)) notFound()

    return <OrdersHeaderView section={filter} />
}
