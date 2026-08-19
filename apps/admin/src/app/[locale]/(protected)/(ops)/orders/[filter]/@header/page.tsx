import { FILTER } from "@/frontend/pages/orders/types";
import { OrdersHeaderView } from "@/frontend/pages/orders/views/orders-header-view";

export default async function Header({ params }: { params: Promise<{ filter: FILTER }> }) {
    const { filter } = await params

    return (
        <OrdersHeaderView filter={filter} />
    )
}
