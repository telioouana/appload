import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { getPathname } from "@/i18n/navigation"
import { defaultSection } from "@/frontend/pages/orders/types"

/**
 * `/orders` has no page of its own: the sections are the pages, and which
 * one a company lands on depends on what it does — a client opens everything
 * it has filed, a carrier the requests waiting for an answer.
 *
 * The path is built through `getPathname` so a Portuguese visitor is sent to
 * the Portuguese URL rather than to the internal one.
 */
export default async function Orders() {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const locale = await getLocale()

    redirect(getPathname({
        href: { pathname: "/orders/[section]", params: { section: defaultSection(tenant.orgType) } },
        locale,
    }))
}
