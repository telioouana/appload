import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"

export async function generateMetadata() {
    const t = await getTranslations("Admin.partners")

    return { title: t("shippers.title") }
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
