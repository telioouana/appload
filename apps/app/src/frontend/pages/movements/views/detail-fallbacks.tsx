import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * A load page's footprint while it streams in: the header, then the two
 * columns. Shape-matched so the layout does not jump when the load arrives.
 */
export function LoadDetailSkeleton() {
    return (
        <>
            <div className="flex items-start gap-3 px-2">
                <Skeleton className="mt-4 size-9 rounded-md" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-40 rounded-md" />
                    <Skeleton className="h-8 w-56 rounded-lg" />
                    <Skeleton className="h-4 w-72 rounded-md" />
                </div>
            </div>

            <div className="grid gap-4 px-2 lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]">
                <div className="flex flex-col gap-4">
                    <Skeleton className="h-80 w-full rounded-2xl" />
                    <Skeleton className="h-40 w-full rounded-2xl" />
                    <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
                <div className="flex flex-col gap-4">
                    <Skeleton className="h-40 w-full rounded-2xl" />
                    <Skeleton className="h-72 w-full rounded-2xl" />
                </div>
            </div>
        </>
    )
}
