import { redirect } from "next/navigation"

import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"
import { DEFAULT_SECTION } from "@/frontend/pages/movements/types"

/**
 * `/orders` has no page of its own: the sections are the pages, and the list
 * opens on all of them. Built through `getPathname` so a Portuguese visitor
 * is sent to the Portuguese URL rather than to the internal one.
 */
export default async function Orders() {
    const locale = await getLocale()

    redirect(getPathname({
        href: { pathname: "/orders/[section]", params: { section: DEFAULT_SECTION } },
        locale,
    }))
}
