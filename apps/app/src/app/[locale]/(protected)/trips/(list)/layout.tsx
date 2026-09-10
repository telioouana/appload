import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"

export async function generateMetadata() {
    const t = await getTranslations("App.trips")

    return { title: t("metadata") }
}

// The list lives in its own route group so the parallel slots below stay
// with it: `/trips/[tripId]` is a sibling of the group, not a child of this
// layout, and renders as a page of its own
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
