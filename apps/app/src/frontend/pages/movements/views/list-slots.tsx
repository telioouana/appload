import "server-only"

import { cache, Suspense } from "react"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getLocale, getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { HeaderSkeleton, ListError, ListSkeleton, TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { getPathname } from "@/i18n/navigation"
import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { MovementsDataView } from "@/frontend/pages/movements/views/movements-data-view"
import { MovementsHeaderView } from "@/frontend/pages/movements/views/movements-header-view"
import { MovementsStatsView } from "@/frontend/pages/movements/views/movements-stats-view"
import { MOVEMENT_TABS, defaultTab, isSection, movementsListInput, type MovementSection } from "@/frontend/pages/movements/types"

/**
 * One page, two tabs: the section is the route segment under
 * `orders/[section]`, and which of the company's two lists it shows — its own
 * trucks or its partners' — is `?tab=`. The route files are one line each and
 * the work is here: check the segment, settle the tab, prefetch what the
 * view reads, and hydrate it.
 */

type SectionParams = { params: Promise<{ section: string }> }
type SearchParams = { searchParams: Promise<Record<string, string | string[] | undefined>> }

async function sectionOrNotFound(params: SectionParams["params"]): Promise<MovementSection> {
    const { section } = await params

    if (!isSection(section)) notFound()

    return section
}

/** The query string as the input builder reads it: one value per key, or none. */
const getterOf = (search: Record<string, string | string[] | undefined>) => (key: string) => {
    const value = search[key]
    return typeof value === "string" ? value : null
}

/**
 * What the company is, the way the protected layout reads it. Cached for the
 * request, so the three slots of one page share a single read.
 */
const tenantOrgType = cache(async () => {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    return tenant.orgType
})

/**
 * The list input for a slot, with the tab settled. A URL that names no tab
 * (or names one that does not exist) is sent to the company's own default —
 * a client to its transporters, a transporter to its own trucks — with the
 * rest of its query kept, so every address on this page says which side it
 * shows. A layout cannot read the query string, so each slot asks; the first
 * to answer redirects, and the others throw the same way.
 */
async function inputOrRedirect(section: MovementSection, searchParams: SearchParams["searchParams"]) {
    const search = await searchParams
    const get = getterOf(search)
    const orgType = await tenantOrgType()
    const tab = get("tab")

    if (tab === null || !(MOVEMENT_TABS as readonly string[]).includes(tab)) {
        const locale = await getLocale()
        const kept = Object.fromEntries(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === "string"))

        redirect(getPathname({
            href: { pathname: "/orders/[section]", params: { section }, query: { ...kept, tab: defaultTab(orgType) } },
            locale,
        }))
    }

    return movementsListInput(section, get, orgType)
}

export async function movementsListMetadata({ params }: SectionParams) {
    const { section } = await params

    // An unknown segment gets no title; the layout below answers it with a 404
    if (!isSection(section)) return {}

    const t = await getTranslations("App.loads.titles")

    return { title: t(section) }
}

export async function MovementsListLayout({
    params,
    header,
    stats,
    data,
}: SectionParams & {
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    await sectionOrNotFound(params)

    return <ListPageShell header={header} stats={stats} data={data} />
}

export async function MovementsHeaderSlot({ params, searchParams }: SectionParams & SearchParams) {
    const section = await sectionOrNotFound(params)
    const { scope } = await inputOrRedirect(section, searchParams)

    prefetch(trpc.me.session.queryOptions())
    // Both tabs' counts: each pill carries the section's count on its side
    prefetch(trpc.movements.stats.queryOptions({ scope: "trips" }))
    prefetch(trpc.movements.stats.queryOptions({ scope: "orders" }))

    return (
        <HydrateClient>
            <Suspense fallback={<HeaderSkeleton />}>
                <MovementsHeaderView scope={scope} section={section} />
            </Suspense>
        </HydrateClient>
    )
}

export async function MovementsStatsSlot({ params, searchParams }: SectionParams & SearchParams) {
    const section = await sectionOrNotFound(params)
    const { scope } = await inputOrRedirect(section, searchParams)

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.stats.queryOptions({ scope }))
    prefetch(trpc.movements.cashflow.queryOptions({ scope, section }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<TilesSkeleton />}>
                <Suspense fallback={<TilesSkeleton />}>
                    <MovementsStatsView scope={scope} section={section} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}

export async function MovementsDataSlot({ params, searchParams }: SectionParams & SearchParams) {
    const section = await sectionOrNotFound(params)
    const t = await getTranslations("App.loads.data")

    // The same input builder the client view uses, so the server-fetched
    // first page hydrates straight into the client query
    const input = await inputOrRedirect(section, searchParams)

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.list.queryOptions(input))
    prefetch(trpc.movements.stats.queryOptions({ scope: input.scope }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <MovementsDataView scope={input.scope} section={section} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
