import { redirect } from "next/navigation"

import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

/**
 * The quotes moved out from under the brokerage and into My company, where
 * the rest of what the company keeps standing lives. The old address stays:
 * the notifications written before the move point at it.
 */
export default async function ApploadQuotesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const id = typeof search.id === "string" ? search.id : undefined
    const locale = await getLocale()

    redirect(getPathname({ href: { pathname: "/quotes", query: id ? { id } : undefined }, locale }))
}
