import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { contract } from "@workspace/db/contracts"
import { db } from "@workspace/db/db"
import { getLocale, getTranslations } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ContractDetailSkeleton } from "@/frontend/pages/contracts/views/detail-fallbacks"
import { ContractDetailView } from "@/frontend/pages/contracts/views/contract-detail-view"

export async function generateMetadata() {
    const t = await getTranslations("App.contracts.detail")

    return { title: t("meta") }
}

/**
 * One multi-trip order, read by whoever is on it: the owner sees the whole,
 * the client the terms and the paper, a transporter only its own share.
 * What each may see and do was decided by the server, role by role. A
 * static segment beside `orders/[section]`, like a load's page.
 */
export default async function MultiTripOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const t = await getTranslations("App.contracts.detail")

    // A rental is the same row counted in days, with a page of its own; the
    // notifications and the old addresses only know the row
    const [row] = await db.select({ basis: contract.basis }).from(contract).where(eq(contract.id, orderId)).limit(1)
    if (row?.basis === "days") {
        redirect(getPathname({ href: { pathname: "/orders/rental/[orderId]", params: { orderId } }, locale: await getLocale() }))
    }

    prefetch(trpc.me.session.queryOptions())
    prefetch(trpc.contracts.get.queryOptions({ id: orderId }))

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
                        <ContractDetailView contractId={orderId} />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
