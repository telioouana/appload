import { notFound } from "next/navigation"

import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@/components/list/list-page-shell"
import { isSection } from "@/frontend/pages/orders/types"

type Params = Promise<{ filter: string }>

export async function generateMetadata({ params }: { params: Params }) {
    const { filter } = await params

    if (!isSection(filter)) return {}

    const t = await getTranslations("Admin.orders.list")
    return { title: t(`pages.${filter}.title`) }
}

/**
 * One page per section (all, prospect, booked…). The static `details` and
 * `disputes` segments win over this one in Next's routing; anything else
 * that is not a section is a 404, checked here and in every slot before
 * a query is prefetched.
 */
export default async function Layout({
    params,
    header,
    stats,
    data,
}: {
    params: Params
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    const { filter } = await params

    if (!isSection(filter)) notFound()

    return <ListPageShell header={header} stats={stats} data={data} />
}
