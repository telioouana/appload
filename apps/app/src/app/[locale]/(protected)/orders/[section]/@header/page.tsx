import { MovementsHeaderSlot } from "@/frontend/pages/movements/views/list-slots"

export default function Header({
    params,
    searchParams,
}: {
    params: Promise<{ section: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    return <MovementsHeaderSlot params={params} searchParams={searchParams} />
}
