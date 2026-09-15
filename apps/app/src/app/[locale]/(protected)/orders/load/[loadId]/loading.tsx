import { LoadDetailSkeleton } from "@/frontend/pages/movements/views/detail-fallbacks"

// The page's own frame around its skeleton, so the shape is on screen the
// moment the route is entered — before the load has streamed in
export default function Loading() {
    return (
        <div className="container-snap flex h-full min-h-0 flex-col gap-5 overflow-y-auto pt-5 pb-2 lg:overflow-hidden">
            <LoadDetailSkeleton />
        </div>
    )
}
