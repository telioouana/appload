import { redirect } from "next/navigation"

import { getLocale } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"

/** A contract's old address opens the same multi-trip order under Pedidos. */
export default async function ContractPage({ params }: { params: Promise<{ contractId: string }> }) {
    const { contractId } = await params
    const locale = await getLocale()

    redirect(getPathname({ href: { pathname: "/orders/multi/[orderId]", params: { orderId: contractId } }, locale }))
}
