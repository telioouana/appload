import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { kindFromSlug } from "@/frontend/pages/fleet/types"

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const vehicle = kindFromSlug(kind)

    if (!vehicle) return {}

    const t = await getTranslations("App.fleet")

    return { title: t(`title.${vehicle}`) }
}

/**
 * Trucks, trailers and links are three routes rather than one filtered page,
 * so each is addressable and a shared link opens the fleet the sender meant.
 * Anything else in the segment is a 404, as is the whole route for a shipper:
 * only carriers have a fleet, and the tRPC procedures behind it are
 * carrier-gated too.
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

    if (!kindFromSlug(kind)) notFound()

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) notFound()

    return <ListPageShell header={header} stats={stats} data={data} />
}
