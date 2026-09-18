import { DetailsSkeleton } from "@/frontend/pages/order/views/details-fallbacks"

// The page's frame around its own skeleton, so the shape is on screen the
// moment the route is entered — before the order has streamed in
export default function Loading() {
    return (
        <div className="container-snap flex h-full min-h-0 flex-col gap-5 overflow-y-auto pt-5 pb-2 lg:overflow-hidden">
            <DetailsSkeleton />
        </div>
    )
}
