import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"
import { linkedMovementId } from "@workspace/domain/appload/link"

import { getPathname } from "@/i18n/navigation"

/**
 * An Appload order has no page of its own in the portal any more: the company
 * reads it on its own load, the row linked to that order. The address stays,
 * because every notification and email written so far points at it — it now
 * looks the load up and sends the reader there.
 *
 * A reader with no row on the order has no business on it, which is a 404
 * rather than a redirect to somebody else's load.
 */
export default async function ApploadOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const loadId = await linkedMovementId(db, {
        orderId: decodeURIComponent(orderId),
        organizationId: tenant.organizationId,
    })

    if (!loadId) notFound()

    const locale = await getLocale()

    redirect(getPathname({
        href: { pathname: "/orders/load/[loadId]", params: { loadId } },
        locale,
    }))
}
