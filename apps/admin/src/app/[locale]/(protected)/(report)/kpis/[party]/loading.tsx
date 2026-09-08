import { KpisReportSkeleton } from "@/frontend/pages/kpis/views/kpis-fallbacks"

// The page's frame around its own skeleton, so the shape is on screen the
// moment a row is opened — before the report has streamed in
export default function Loading() {
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 pt-5 pb-2">
            <KpisReportSkeleton />
        </div>
    )
}
