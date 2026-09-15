import { Skeleton } from "@workspace/ui/components/skeleton"

import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { CardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"

/**
 * The metrics page while its first paint streams in: the header lines, the
 * four tiles, then the two bands at the heights they settle at — the revenue
 * pair and the month-by-month chart — so nothing jumps once the sheet lands.
 *
 * Everything below that is a card behind its own boundary in the view, which
 * brings its own placeholder; only what the shell owns is drawn here. The
 * boundary, card and error shapes are the dashboard's, imported rather than
 * copied: both pages are the same surface at the same gutter.
 */
export function MetricsSkeleton() {
    return (
        <>
            <div className="flex flex-col gap-2 px-2">
                <Skeleton className="h-8 w-48 rounded-lg" />
                <Skeleton className="h-4 w-72 rounded-md" />
            </div>

            <TilesSkeleton />

            <CardSkeleton className="h-72 shrink-0 xl:h-80" />
            <CardSkeleton className="h-72 shrink-0 xl:h-80" />
        </>
    )
}
