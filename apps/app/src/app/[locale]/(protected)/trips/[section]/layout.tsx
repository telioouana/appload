import { MovementsListLayout, movementsListMetadata } from "@/frontend/pages/movements/views/list-slots"

type Params = { params: Promise<{ section: string }> }

export const generateMetadata = (props: Params) => movementsListMetadata("trips", props)

export default function Layout({
    params,
    header,
    stats,
    data,
}: Params & { header: React.ReactNode; stats: React.ReactNode; data: React.ReactNode }) {
    return <MovementsListLayout scope="trips" params={params} header={header} stats={stats} data={data} />
}
