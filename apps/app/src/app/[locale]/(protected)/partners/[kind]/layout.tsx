import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { kindFromSlug, kindsFor } from "@/frontend/pages/partners/types"

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const list = kindFromSlug(kind)

    if (!list) return {}

    const t = await getTranslations("App.partners")

    return { title: t(`titles.${list}`) }
}

/**
 * Clients, transporters and requests are three routes rather than one page
 * with tabs, so each is addressable and a shared link opens the list the
 * sender meant. Anything else in the segment is a 404, and so is the clients
 * list for a shipper: a shipper only ever connects to carriers, and
 * `partners.list` refuses that kind too.
 */
export default async function Layout({
    params,
    header,
    stats,
    data,
}: {
    params: Promise<{ kind: string }>
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    const { kind } = await params
    const list = kindFromSlug(kind)

    if (!list) notFound()

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok || !kindsFor(tenant.orgType).includes(list)) notFound()

    return <ListPageShell header={header} stats={stats} data={data} />
}
