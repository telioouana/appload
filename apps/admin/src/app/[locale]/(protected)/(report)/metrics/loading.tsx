import { MetricsSkeleton } from "@/frontend/pages/metrics/views/metrics-fallbacks"

// The page's frame around its own skeleton, so the shape is on screen the
// moment the route is entered — before the page has streamed in
export default function Loading() {
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <MetricsSkeleton />
        </div>
    )
}
