import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { getPathname } from "@/i18n/navigation"
import { DEFAULT_SECTION, defaultTab } from "@/frontend/pages/movements/types"

/**
 * `/orders` has no page of its own: the sections are the pages, and the list
 * opens on all of them, on the tab the company lands on — a client on its
 * transporters, a transporter on its own trucks. Built through `getPathname`
 * so a Portuguese visitor is sent to the Portuguese URL rather than to the
 * internal one.
 */
export default async function Orders() {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const locale = await getLocale()

    redirect(getPathname({
        href: { pathname: "/orders/[section]", params: { section: DEFAULT_SECTION }, query: { tab: defaultTab(tenant.orgType) } },
        locale,
    }))
}
