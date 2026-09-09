import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { SettingsView } from "@/frontend/pages/settings/views/settings-view"
import { SettingsError, SettingsSkeleton } from "@/frontend/pages/settings/views/settings-fallbacks"

export async function generateMetadata() {
    const t = await getTranslations("App.settings")

    return { title: t("title") }
}

export default async function SettingsPage() {
    const t = await getTranslations("App.settings")

    // Takes no input, so the server-fetched session hydrates straight into
    // the client query instead of being refetched
    prefetch(trpc.me.session.queryOptions())

    return (
        // The protected layout clips its own overflow, so the scroll
        // container is this page's job.
        //
        // `w-full` is load-bearing: this is a flex item in main's column, and
        // an auto cross-axis margin cancels `align-self: stretch`. Without a
        // definite width the column shrinks to its content, so each tab would
        // render at a different width.
        <div className="container-snap mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto py-4">
            <HydrateClient>
                <ErrorBoundary fallback={<SettingsError message={t("error")} />}>
                    <Suspense fallback={<SettingsSkeleton />}>
                        <SettingsView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
