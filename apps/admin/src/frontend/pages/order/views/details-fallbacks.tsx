import { Skeleton } from "@workspace/ui/components/skeleton"

// Mirrors the real page — header, trip strip, then the main column and its
// rail — so nothing jumps when the order arrives
export function DetailsSkeleton() {
    return (
        <>
            <div className="flex flex-col gap-2 px-2">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
            </div>

            <div className="px-2">
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>

            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,700px)_minmax(320px,1fr)]">
                <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                    <Skeleton className="h-56 w-full shrink-0 rounded-2xl" />
                    <Skeleton className="h-80 w-full shrink-0 rounded-2xl" />
                    <Skeleton className="h-44 w-full shrink-0 rounded-2xl" />
                </div>
                <Skeleton className="h-96 w-full rounded-2xl lg:h-full" />
            </div>
        </>
    )
}
