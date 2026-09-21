import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton, StripSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { reportInput } from "@/frontend/pages/reports/types"
import { ReportView } from "@/frontend/pages/reports/views/report-view"

export async function generateMetadata() {
    const t = await getTranslations("App.reports")

    return { title: t("title") }
}

export default async function ReportsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("App.reports")

    // The same input builder the client view uses, so the first page
    // hydrates from what was fetched here instead of asking again
    const input = reportInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.movements.costReport.queryOptions(input))
    prefetch(trpc.movements.formOptions.queryOptions())

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pt-5 pb-2">
            <HydrateClient>
                <ErrorBoundary fallback={<ListError message={t("error")} />}>
                    <Suspense fallback={<><StripSkeleton /><ListSkeleton /></>}>
                        <ReportView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
