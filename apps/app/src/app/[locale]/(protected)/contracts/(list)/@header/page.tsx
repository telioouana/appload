import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { HeaderSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { ContractsHeaderView } from "@/frontend/pages/contracts/views/contracts-header-view"

export default function Header() {
    // The action is gated on the reader's role, and the two tab pills each
    // carry their own side's count — so both tabs' stats are read here
    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.stats.queryOptions({ tab: "own" }))
    prefetch(trpc.contracts.stats.queryOptions({ tab: "partners" }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<HeaderSkeleton />}>
                <Suspense fallback={<HeaderSkeleton />}>
                    <ContractsHeaderView />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
