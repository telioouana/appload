import { MovementsStatsSlot } from "@/frontend/pages/movements/views/list-slots"

export default function Stats({
    params,
    searchParams,
}: {
    params: Promise<{ section: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    return <MovementsStatsSlot params={params} searchParams={searchParams} />
}
