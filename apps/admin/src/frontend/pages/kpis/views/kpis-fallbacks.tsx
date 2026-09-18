import { Skeleton } from "@workspace/ui/components/skeleton"

import { TilesSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

import { CardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"

/**
 * The list header's footprint: the title, the line naming the period, the
 * controls that change it, and the search box on the right. The directories'
 * `HeaderSkeleton` is the wrong shape here — it draws an eyebrow this page
 * has no room for and none of the period row, so the tiles and the card would
 * step down the moment the real header mounted.
 */
export function KpisHeaderSkeleton() {
    return (
        <div className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-1">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <Skeleton className="h-4 w-72 rounded-md" />

                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Skeleton className="h-8 w-56 rounded-3xl" />
                    <Skeleton className="h-8 w-24 rounded-3xl" />
                </div>
            </div>

            <Skeleton className="h-9 w-full rounded-md sm:w-80" />
        </div>
    )
}

/**
 * One party's report while its first paint streams in: the eyebrow and the
 * name, the line naming the period, the controls that change it, then the
 * four tiles and the two bands at the heights they settle at — the charts row
 * and the full table — so nothing jumps once the figures land.
 *
 * Everything between those bands is a card behind its own boundary in the
 * view, which brings its own placeholder; only what the page owns is drawn
 * here. The card shapes are the dashboard's and the tiles the list pages',
 * imported rather than copied: all three report pages are the same surface.
 */
export function KpisReportSkeleton() {
    return (
        <>
            <div className="flex items-start gap-3 px-2">
                <Skeleton className="mt-4 size-9 shrink-0 rounded-lg" />

                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-16 rounded-md" />
                    <Skeleton className="h-8 w-56 rounded-lg" />
                    <Skeleton className="h-4 w-72 rounded-md" />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-2">
                <Skeleton className="h-8 w-56 rounded-3xl" />
                <Skeleton className="h-8 w-32 rounded-3xl" />
            </div>

            <TilesSkeleton />

            <CardSkeleton className="h-[300px] shrink-0 xl:h-[340px]" />
            <CardSkeleton className="h-[420px] shrink-0" />
        </>
    )
}
