import { getTranslations } from "@workspace/i18n/server"

import { StaffView } from "@/frontend/pages/staff/views/staff-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.staff")

    return {
        title: t("title"),
    }
}

export default function StaffPage() {
    return (
        // Same frame as the settings page: `w-full` keeps the flex item from
        // shrinking to its content
        <div className="container-snap mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto py-4">
            <StaffView />
        </div>
    )
}
