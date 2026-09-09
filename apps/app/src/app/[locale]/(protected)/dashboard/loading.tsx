import { Skeleton } from "@workspace/ui/components/skeleton"

// The shell stays up while this renders, so only the card is drawn — the
// same box the page fills, so nothing jumps when it lands
export default function DashboardLoading() {
    return (
        <div className="flex-1 min-h-0 overflow-hidden py-4">
            <div className="mx-auto grid max-w-3xl gap-4 rounded-xl border p-6">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-4 w-full max-w-md" />
                <div className="flex gap-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-6 w-24" />
                </div>
                <div className="grid gap-2 pt-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            </div>
        </div>
    )
}
