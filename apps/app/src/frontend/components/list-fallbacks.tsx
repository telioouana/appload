import { Skeleton } from "@workspace/ui/components/skeleton"

import { ListCard } from "@/components/list/list-card"

/** Shape-matched placeholder for the table card while the first page loads. */
export function ListSkeleton() {
    return (
        <ListCard>
            <div className="flex h-12 items-center gap-6 border-b px-4">
                {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-4 w-20 rounded-md" />
                ))}
            </div>
            <div className="flex flex-col">
                {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="flex h-15 items-center gap-4 border-b px-4 last:border-0">
                        <Skeleton className="size-9 rounded-full" />
                        <Skeleton className="h-4 w-40 rounded-md" />
                        <Skeleton className="h-4 w-24 rounded-md" />
                        <Skeleton className="h-4 w-32 rounded-md" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                ))}
            </div>
        </ListCard>
    )
}

/** Four tile-shaped placeholders. */
export function TilesSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-[72px] w-full rounded-2xl" />
            ))}
        </div>
    )
}

/** A money-strip-shaped placeholder: a title row and two currency rows. */
export function StripSkeleton() {
    return (
        <div className="mx-2 flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-foreground/5">
            <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-48 rounded-md" />
                <Skeleton className="h-5 w-40 rounded-full" />
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full rounded-md" />
            ))}
        </div>
    )
}

/**
 * The page header's footprint — eyebrow, title and description on the left,
 * the search box on the right — until the slot's own view mounts.
 */
export function HeaderSkeleton() {
    return (
        <div className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-40 rounded-md" />
                <Skeleton className="h-8 w-48 rounded-lg" />
                <Skeleton className="h-4 w-72 rounded-md" />
            </div>
            <Skeleton className="h-9 w-full rounded-md sm:w-80" />
        </div>
    )
}

export function ListError({ message }: { message: string }) {
    return (
        <ListCard>
            <p className="text-destructive py-10 text-center text-sm">{message}</p>
        </ListCard>
    )
}
