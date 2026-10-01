import { redirect } from "next/navigation"

import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

/**
 * Contracts are multi-trip orders now, the "Várias viagens" section of
 * Pedidos. The old address stays for the links already out there and
 * carries its tab across.
 */
export default async function ContractsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const search = await searchParams
    const tab = search.tab === "partners" ? "partners" : search.tab === "own" ? "own" : undefined
    const locale = await getLocale()

    redirect(getPathname({ href: { pathname: "/orders/[section]", params: { section: "multi" }, query: tab ? { tab } : undefined }, locale }))
}
