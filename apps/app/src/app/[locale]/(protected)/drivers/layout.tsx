import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"

export async function generateMetadata() {
    const t = await getTranslations("App.drivers")

    return { title: t("title") }
}

/**
 * Drivers belong to a carrier, so the whole route is a 404 for a shipper —
 * the same answer the carrier-gated procedures behind it would give.
 */
export default async function Layout({
    header,
    stats,
    data,
}: {
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok || tenant.orgType !== "carrier") notFound()

    return <ListPageShell header={header} stats={stats} data={data} />
}
