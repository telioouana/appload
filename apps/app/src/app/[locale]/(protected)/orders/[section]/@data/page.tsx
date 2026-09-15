import { MovementsDataSlot } from "@/frontend/pages/movements/views/list-slots"

export default function Data({
    params,
    searchParams,
}: {
    params: Promise<{ section: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    return <MovementsDataSlot params={params} searchParams={searchParams} />
}
