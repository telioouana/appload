import { ListPageShell } from "@/components/list/list-page-shell"

export default function Layout({
    header,
    stats,
    data,
}: {
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    return <ListPageShell header={header} stats={stats} data={data} />
}
