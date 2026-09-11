import "server-only"

import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { HeaderSkeleton, ListError, ListSkeleton, TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { MovementsDataView } from "@/frontend/pages/movements/views/movements-data-view"
import { MovementsHeaderView } from "@/frontend/pages/movements/views/movements-header-view"
import { MovementsStatsView } from "@/frontend/pages/movements/views/movements-stats-view"
import { isScopeSection, movementsListInput, type MovementScope, type MovementSection } from "@/frontend/pages/movements/types"

/**
 * The two lists are one page with two scopes, so their route files under
 * `orders/[section]` and `trips/[section]` are one line each and the work is
 * here: check the segment, prefetch what the view reads, and hydrate it.
 */

type SectionParams = { params: Promise<{ section: string }> }

async function sectionOrNotFound(scope: MovementScope, params: SectionParams["params"]): Promise<MovementSection> {
    const { section } = await params

    if (!isScopeSection(scope, section)) notFound()

    return section
}

export async function movementsListMetadata(scope: MovementScope, { params }: SectionParams) {
    const { section } = await params

    // An unknown segment gets no title; the layout below answers it with a 404
    if (!isScopeSection(scope, section)) return {}

    const t = await getTranslations("App.loads.titles")

    return { title: section === "all" ? t(`all-${scope}`) : t(section) }
}

export async function MovementsListLayout({
    scope,
    params,
    header,
    stats,
    data,
}: SectionParams & {
    scope: MovementScope
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    await sectionOrNotFound(scope, params)

    return <ListPageShell header={header} stats={stats} data={data} />
}

export async function MovementsHeaderSlot({ scope, params }: SectionParams & { scope: MovementScope }) {
    const section = await sectionOrNotFound(scope, params)

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.stats.queryOptions({ scope }))

    return (
        <HydrateClient>
            <Suspense fallback={<HeaderSkeleton />}>
                <MovementsHeaderView scope={scope} section={section} />
            </Suspense>
        </HydrateClient>
    )
}

export async function MovementsStatsSlot({ scope, params }: SectionParams & { scope: MovementScope }) {
    const section = await sectionOrNotFound(scope, params)

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.stats.queryOptions({ scope }))

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

export async function MovementsDataSlot({
    scope,
    params,
    searchParams,
}: SectionParams & {
    scope: MovementScope
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const section = await sectionOrNotFound(scope, params)
    const search = await searchParams
    const t = await getTranslations("App.loads.data")

    // The same input builder the client view uses, so the server-fetched
    // first page hydrates straight into the client query
    const input = movementsListInput(scope, section, (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.movements.list.queryOptions(input))
    prefetch(trpc.movements.stats.queryOptions({ scope }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <MovementsDataView scope={scope} section={section} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
