import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"

export async function generateMetadata() {
    const t = await getTranslations("App.contracts")

    return { title: t("metadata") }
}

// The `(list)` group keeps the three slots to the list itself: a contract's
// own page under `contracts/[contractId]` is a plain route beside it
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
