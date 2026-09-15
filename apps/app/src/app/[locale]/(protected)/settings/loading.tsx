import { SettingsSkeleton } from "@/frontend/pages/settings/views/settings-fallbacks"

// The page's frame around the view's own skeleton, so the shape is on
// screen the moment the route is entered — before the session has loaded
export default function Loading() {
    return (
        <div className="container-snap mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto py-4">
            <SettingsSkeleton />
        </div>
    )
}
