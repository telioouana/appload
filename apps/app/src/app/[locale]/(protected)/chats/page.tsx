import { Suspense } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { ErrorBoundary } from "react-error-boundary"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { HydrateClient, prefetch, trpc } from "@/backend/api/server"
import { ListError, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"
import { ChatsView } from "@/frontend/pages/threads/views/chats-view"

export async function generateMetadata() {
    const t = await getTranslations("App.threads.page")

    return { title: t("title") }
}

export default async function ChatsPage() {
    // The chats module off: the page is not there, the way its rail row is not
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok || !tenant.modules.has("chats")) redirect("/dashboard")

    const t = await getTranslations("App.threads.page")

    // Who is looking, which the open conversation reads to tell the reader's
    // own messages apart. The two lists are not prefetched: they poll, and
    // the unread count is the rail's query — a key the rail observed first
    // reaches a page's server render empty
    prefetch(trpc.me.session.queryOptions())

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden py-4">
            <HydrateClient>
                <ErrorBoundary fallback={<ListError message={t("error")} />}>
                    <Suspense fallback={<ListSkeleton />}>
                        <ChatsView />
                    </Suspense>
                </ErrorBoundary>
            </HydrateClient>
        </div>
    )
}
