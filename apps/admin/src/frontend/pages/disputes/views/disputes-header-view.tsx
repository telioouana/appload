"use client"

import { useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"

/** Title, count and search. Disputes are opened from an order, so there is no primary action here. */
export function DisputesHeaderView() {
    const t = useTranslations("Admin.disputes")
    const tOrders = useTranslations("Admin.orders.list")
    const trpc = useTRPC()

    const { data: stats } = useQuery(trpc.disputes.stats.queryOptions())

    return (
        <PageHeader
            eyebrow={[tOrders("eyebrow"), tOrders("title"), t("title")]}
            title={t("title")}
            count={stats?.total}
            description={t("description")}
            search={{ placeholder: t("search"), clearLabel: t("clear-search") }}
        />
    )
}
