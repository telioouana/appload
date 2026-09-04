import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@/components/list/list-page-shell"

export async function generateMetadata() {
    const t = await getTranslations("Admin.disputes")
    return { title: t("title") }
}

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
