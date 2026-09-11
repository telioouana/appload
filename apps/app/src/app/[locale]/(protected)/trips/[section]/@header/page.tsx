import { MovementsHeaderSlot } from "@/frontend/pages/movements/views/list-slots"

export default function Header({ params }: { params: Promise<{ section: string }> }) {
    return <MovementsHeaderSlot scope="trips" params={params} />
}
