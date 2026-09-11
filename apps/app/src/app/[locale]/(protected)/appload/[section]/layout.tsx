import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { ORDER_SECTIONS, isSection, type OrderSection } from "@/frontend/pages/orders/types"

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
    const { section } = await params

    // Named without waiting on the tenant read below: whether this
    // organization type HAS the section is that check's business, and an
    // unknown segment simply gets no title
    if (!(ORDER_SECTIONS as readonly string[]).includes(section)) return {}

    const t = await getTranslations("App.orders")

    return { title: t(`title.${section as OrderSection}`) }
}

/**
 * The sections are routes rather than one filtered page, so each is
 * addressable and a shared link opens the list the sender meant. Which ones
 * exist depends on the organization type — a carrier has no "all" — and a
 * section the caller does not have is a 404, exactly as `orders.list` would
 * refuse it.
 */
export default async function Layout({
    params,
    header,
    stats,
    data,
}: {
    params: Promise<{ section: string }>
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    const { section } = await params

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok || !isSection(tenant.orgType, section)) notFound()

    return <ListPageShell header={header} stats={stats} data={data} />
}
