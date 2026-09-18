import { HeaderSkeleton, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

/**
 * The page is one client view over both slots, so its placeholder covers the
 * title and the card together — the route's own loading state and the
 * Suspense fallback are the same shape.
 */
export function NotificationsSkeleton() {
    return (
        <>
            <HeaderSkeleton />
            <ListSkeleton />
        </>
    )
}
