import { ListSkeleton, StripSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

// The page's frame around its own skeleton, so the shape is on screen the
// moment the route is entered — before the first figures have landed
export default function Loading() {
    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pt-5 pb-2">
            <StripSkeleton />
            <ListSkeleton />
        </div>
    )
}
