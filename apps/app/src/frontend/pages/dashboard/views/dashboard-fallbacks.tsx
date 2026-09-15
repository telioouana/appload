import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { cn } from "@workspace/ui/lib/utils"

/**
 * A card-shaped placeholder. It carries the page gutter itself, so a band
 * that already has one (the two- and three-column grids) passes `mx-0` and
 * keeps its own grid gap honest.
 */
export function CardSkeleton({ className }: { className?: string }) {
    return <Skeleton className={cn("mx-2 rounded-2xl", className)} />
}

/** The top row's five figures, at the height they settle at. */
export function TilesSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-3 px-2 sm:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-[72px] w-full rounded-2xl" />
            ))}
        </div>
    )
}

/**
 * One card that could not load, in the same words and tone as the list
 * pages' `ListError` but on the board's own surface: the rest of it goes on
 * working around the gap.
 */
export function CardError({ message, className }: { message: string; className?: string }) {
    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 mx-2 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <p className="text-destructive py-10 text-center text-sm">{message}</p>
        </section>
    )
}

/**
 * Every card streams and fails on its own: the boundary catches its query's
 * error and the Suspense holds its shape until the data lands, so one failing
 * procedure never takes the whole board down.
 */
export function CardBoundary({
    fallback,
    message,
    className,
    children,
}: {
    fallback: React.ReactNode
    message: string
    /** Handed to the error card so it keeps the fallback's footprint */
    className?: string
    children: React.ReactNode
}) {
    return (
        <ErrorBoundary fallback={<CardError message={message} className={className} />}>
            <Suspense fallback={fallback}>{children}</Suspense>
        </ErrorBoundary>
    )
}

/**
 * The whole board while the first paint streams in: the greeting lines, the
 * five tiles, then the two bands at the heights they settle at — the map and
 * the chart — so nothing jumps once the data arrives.
 */
export function DashboardSkeleton() {
    return (
        <>
            <div className="flex flex-col gap-2 px-2">
                <Skeleton className="h-8 w-56 rounded-lg" />
                <Skeleton className="h-6 w-72 rounded-full" />
                <Skeleton className="h-4 w-64 rounded-md" />
            </div>

            <TilesSkeleton />

            {/* The map band: h-64 on a phone, 420 from lg up */}
            <CardSkeleton className="h-64 shrink-0 lg:h-[420px]" />

            {/* The chart band: a 220/260 px plot under its title and legend */}
            <CardSkeleton className="h-72 shrink-0 xl:h-80" />
        </>
    )
}
