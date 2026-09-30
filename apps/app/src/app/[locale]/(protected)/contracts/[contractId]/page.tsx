import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { getTranslations } from "@workspace/i18n/server"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ContractDetailSkeleton } from "@/frontend/pages/contracts/views/detail-fallbacks"
import { ContractDetailView } from "@/frontend/pages/contracts/views/contract-detail-view"

export async function generateMetadata() {
    const t = await getTranslations("App.contracts.detail")

    return { title: t("meta") }
}

/**
 * One contract, read by whoever is on it: the owner sees the whole, the
 * client the terms and the paper, a transporter only its own share. What
 * each may see and do was decided by the server, role by role.
 */
export default async function ContractPage({ params }: { params: Promise<{ contractId: string }> }) {
    const { contractId } = await params
    const t = await getTranslations("App.contracts.detail")

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.get.queryOptions({ id: contractId }))

    return (
        // Full bleed, like the load page: the app inset is the frame and the
        // gutter comes from the sections themselves. From lg up the page
        // itself does not scroll — its columns do
        <div className="container-snap flex h-full min-h-0 flex-col gap-5 overflow-y-auto pt-5 pb-2 lg:overflow-hidden">
            <HydrateClient>
                <ErrorBoundary
                    fallback={
                        <div className="px-2">
                            <Alert variant="destructive">
                                <AlertDescription>{t("error")}</AlertDescription>
                            </Alert>
                        </div>
                    }
                >
                    <Suspense fallback={<ContractDetailSkeleton />}>
                        <ContractDetailView contractId={contractId} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
