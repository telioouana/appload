import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { PartnersHeaderView } from "@/frontend/pages/partners/views/partners-header-view"
import { kindFromSlug } from "@/frontend/pages/partners/types"

export default async function Header({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const list = kindFromSlug(kind)

    if (!list) notFound()

    // The header names the lists from the organization's own type and counts
    // them from the same stats the tiles show
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.partners.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <PartnersHeaderView kind={list} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
