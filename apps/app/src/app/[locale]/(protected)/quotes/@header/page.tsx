import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { QuotesHeaderView } from "@/frontend/pages/quotes/views/quotes-header-view"

export default function Header() {
    // The heading and the one action both come from the organization's own
    // type, and the count is the same stats the tiles show
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.quotes.stats.queryOptions())

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <QuotesHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
