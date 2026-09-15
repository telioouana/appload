import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { kindFromSlug, partnersListInput } from "@/frontend/pages/partners/types"
import { PartnersDataView } from "@/frontend/pages/partners/views/partners-data-view"

export default async function Data({
    params,
    searchParams,
}: {
    params: Promise<{ kind: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const { kind } = await params
    const list = kindFromSlug(kind)

    if (!list) notFound()

    const search = await searchParams
    const t = await getTranslations("App.partners")

    // Same input builder the client view uses, so the server-fetched first
    // page hydrates straight into the client query instead of refetching
    const input = partnersListInput(list, (key: string) => {
        const value = search[key]
        return typeof value === "string" ? value : null
    })

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.partners.list.queryOptions(input))

    return (
        <HydrateClient>
            <ErrorBoundary fallback={<ListError message={t("data.error")} />}>
                <Suspense fallback={<ListSkeleton />}>
                    <PartnersDataView kind={list} />
                </Suspense>
            </ErrorBoundary>
        </HydrateClient>
    )
}
