import { MovementsStatsSlot } from "@/frontend/pages/movements/views/list-slots"

export default function Stats({ params }: { params: Promise<{ section: string }> }) {
    return <MovementsStatsSlot scope="orders" params={params} />
}
