import { IconAlertCircle } from "@tabler/icons-react";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";

// Mirrors the real layout so the page does not jump once the session lands
export function SettingsSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-48 rounded-2xl" />
            <Skeleton className="h-10 w-80 rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
    )
}

export function SettingsError({ message }: { message: string }) {
    return (
        <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>{message}</AlertTitle>
        </Alert>
    )
}
