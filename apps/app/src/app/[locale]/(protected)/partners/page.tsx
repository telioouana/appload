import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { and, eq, or } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale } from "@workspace/i18n/server"
import { partnerConnection } from "@workspace/db/connections"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { getPathname } from "@/i18n/navigation"
import { kindForRelation, kindsFor, type OrgType, type PartnerListKind } from "@/frontend/pages/partners/types"

type Search = Record<string, string | string[] | undefined>

/**
 * The list a `/partners?…` address means. A connection id — what the
 * notification links carry — opens the list that connection sits in: a
 * pending one is a request, any other follows its relation, and an id this
 * tenant is not a side of is unknown. Without one, the retired `tab` and the
 * direction tiles still name a list, and anything else is the organization's
 * first list.
 */
async function kindFor(search: Search, organizationId: string, orgType: OrgType): Promise<PartnerListKind> {
    const fallback = kindsFor(orgType)[0] as PartnerListKind

    if (typeof search.id === "string") {
        const [row] = await db
            .select({ status: partnerConnection.status, relation: partnerConnection.relation })
            .from(partnerConnection)
            .where(and(
                eq(partnerConnection.id, search.id),
                or(eq(partnerConnection.requesterOrgId, organizationId), eq(partnerConnection.targetOrgId, organizationId)),
            ))
            .limit(1)

        if (!row) return fallback

        return row.status === "pending" ? "requests" : kindForRelation(orgType, row.relation)
    }

    if (search.tab === "requests" || search.direction) return "requests"
    if (search.tab === "subcontractors" || search.tab === "transporters") return "transporters"
    if (search.tab === "clients" && orgType === "carrier") return "clients"

    return fallback
}

/**
 * `/partners` has no page of its own: the lists are the pages. It stays as an
 * address because notifications, emails and older links point at it, so it
 * forwards to the list they meant and keeps the rest of the query — the `id`
 * that opens a profile, a search, a direction — dropping only the `tab` the
 * route now carries.
 *
 * The path is built through `getPathname` so a Portuguese visitor is sent to
 * the Portuguese URL rather than to the internal one.
 */
export default async function Partners({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const search = await searchParams
    const query = Object.fromEntries(Object.entries(search).filter(([key]) => key !== "tab"))

    const [kind, locale] = await Promise.all([
        kindFor(search, tenant.organizationId, tenant.orgType),
        getLocale(),
    ])

    redirect(getPathname({
        // An empty query would still leave a bare `?` on the address
        href: { pathname: "/partners/[kind]", params: { kind }, query: Object.keys(query).length > 0 ? query : undefined },
        locale,
    }))
}
