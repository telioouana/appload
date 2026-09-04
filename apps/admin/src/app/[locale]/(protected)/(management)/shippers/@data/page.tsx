import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"
import { organizationsListInput } from "@/frontend/pages/partners/types"
import { OrganizationsDataView } from "@/frontend/pages/partners/views/organizations-data-view"

export default async function Data({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const t = await getTranslations("Admin.partners.data")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = organizationsListInput((key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.partners.organizations.queryOptions({ ...input, type: "shipper" as const }))
    prefetch(trpc.partners.organizationStats.queryOptions({ type: "shipper" }))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <OrganizationsDataView type="shipper" />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
