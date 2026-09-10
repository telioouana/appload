import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { cn } from "@workspace/ui/lib/utils"

import { HeaderSkeleton, TilesSkeleton } from "@/frontend/components/list-fallbacks"

/**
 * A card-shaped placeholder. It carries the page gutter itself, so a band
 * that already has one (the two- and three-column grids) passes `mx-0` and
 * keeps its own grid gap honest.
 */
export function CardSkeleton({ className }: { className?: string }) {
    return <Skeleton className={cn("mx-2 rounded-2xl", className)} />
}

/**
 * One card that could not load, in the same words and tone as the list
 * pages' `ListError` but on the report's own surface: the rest of the page
 * goes on working around it.
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
 * error and the Suspense holds its shape until the data lands, so one
 * failing procedure never takes the whole page down.
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
 * The whole page while the first paint streams in: the header lines, then
 * the bands at the heights they settle at, so nothing jumps once the
 * figures arrive.
 */
export function AnalyticsSkeleton() {
    return (
        <>
            <HeaderSkeleton />

            <CardSkeleton className="h-44 shrink-0" />

            <TilesSkeleton />

            <CardSkeleton className="h-72 shrink-0 xl:h-80" />
        </>
    )
}
