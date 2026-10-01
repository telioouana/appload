import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { contract } from "@workspace/db/contracts"
import { db } from "@workspace/db/db"
import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

/**
 * The quotes page is gone: a standing price on a lane is an open-ended
 * contract now, and lives with the rest of them under Operations. The old
 * address stays because the notifications and emails already sent point at
 * it — a quote id goes to the contract it was carried over as, anything else
 * to the contracts other companies proposed.
 */
export default async function QuotesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const id = typeof search.id === "string" ? search.id : undefined
    const locale = await getLocale()

    if (id) {
        const [row] = await db
            .select({ id: contract.id })
            .from(contract)
            .where(eq(contract.legacyQuoteId, id))
            .limit(1)

        if (row) redirect(getPathname({ href: { pathname: "/orders/multi/[orderId]", params: { orderId: row.id } }, locale }))
    }

    redirect(getPathname({ href: { pathname: "/orders/[section]", params: { section: "all" }, query: { tab: "partners" } }, locale }))
}
