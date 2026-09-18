import { redirect } from "next/navigation"

import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

/**
 * `/appload` is where the brokerage used to live. Appload is a partner like
 * any other now, and its loads are the company's own, so the address simply
 * opens the Orders page — which decides for itself where a company lands.
 */
export default async function ApploadPage() {
    const locale = await getLocale()

    redirect(getPathname({ href: "/orders", locale }))
}
