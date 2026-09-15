import { DashboardSkeleton } from "@/frontend/pages/dashboard/views/dashboard-fallbacks"

// The page's frame around its own skeleton, so the board's shape is on screen
// the moment the route is entered — before the page has streamed in
export default function DashboardLoading() {
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <DashboardSkeleton />
        </div>
    )
}
