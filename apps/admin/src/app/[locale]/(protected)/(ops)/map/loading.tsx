import { ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

// The page's frame around its own skeleton, so the shape is on screen the
// moment the route is entered — before the page has streamed in
export default function Loading() {
    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden py-4">
            <ListSkeleton />
        </div>
    )
}
