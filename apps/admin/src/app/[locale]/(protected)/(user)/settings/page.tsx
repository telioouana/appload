import { getTranslations } from "@workspace/i18n/server"

import { SettingsView } from "@/frontend/pages/settings/views/settings-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.settings")

    return {
        title: t("title"),
    }
}

export default function SettingsPage() {
    return (
        // The protected layout clips its own overflow, so the scroll
        // container is this page's job — same shape as the order details page.
        //
        // `w-full` is load-bearing: this is a flex item in main's column, and
        // an auto cross-axis margin cancels `align-self: stretch`. Without a
        // definite width the column shrinks to its content, so each tab would
        // render at a different width.
        <div className="container-snap mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto py-4">
            <SettingsView />
        </div>
    )
}
