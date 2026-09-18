import { Skeleton } from "@workspace/ui/components/skeleton"

// Mirrors the real layout so the page does not jump once the session lands
export function SettingsSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-48 rounded-2xl" />
            <Skeleton className="h-10 w-64 rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
    )
}
