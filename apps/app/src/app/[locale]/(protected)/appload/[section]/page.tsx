import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { getPathname } from "@/i18n/navigation"
import { defaultTab, type MovementSection } from "@/frontend/pages/movements/types"

/**
 * Where an Appload section used to be. The brokerage is no longer a list of
 * its own: an Appload order is one of the company's own loads, so each of the
 * old pages now opens the section of the Orders page that holds it — the
 * requests and the offers are procurement, the book is booked, and the rest
 * keep their names.
 *
 * The addresses stay because links to them are out in the world already; the
 * rail no longer points at any of them.
 */
const SECTIONS: Record<string, MovementSection> = {
    "all": "all",
    "requests": "procurement",
    "quoted": "procurement",
    "booked": "booked",
    "on-going": "in-progress",
    "delivered": "delivered",
    "history": "history",
}

export default async function ApploadSectionPage({ params }: { params: Promise<{ section: string }> }) {
    const { section } = await params

    const target = SECTIONS[section]

    if (!target) notFound()

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const locale = await getLocale()

    // The tab is the company's own default — a transporter lands on its own
    // trucks, a client on the transporters moving for it — which is where an
    // Appload load sits for each of them
    redirect(getPathname({
        href: { pathname: "/orders/[section]", params: { section: target }, query: { tab: defaultTab(tenant.orgType) } },
        locale,
    }))
}
