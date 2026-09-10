import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@/frontend/components/list-fallbacks"
import { PartnersHeaderView } from "@/frontend/pages/partners/views/partners-header-view"

export default function Header() {
    // The header names the tabs from the organization's own type and counts
    // them from the same stats the tiles show
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.partners.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <PartnersHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
