import { RentalDetailSkeleton } from "@/frontend/pages/rentals/views/detail-fallbacks"

export default function Loading() {
    return (
        <div className="container-snap flex h-full min-h-0 flex-col gap-5 overflow-y-auto pt-5 pb-2 lg:overflow-hidden">
            <RentalDetailSkeleton />
        </div>
    )
}
