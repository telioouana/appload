"use client"

import { IconPlus } from "@tabler/icons-react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { SectionTabs } from "@/frontend/pages/orders/components/section-tabs"
import { useNewOrder } from "@/frontend/pages/orders/hooks/use-new-order"
import { NewOrderSheet } from "@/frontend/pages/orders/sections/new-order-sheet"
import type { OrderSection } from "@/frontend/pages/orders/types"

/**
 * The top of the orders list: which section is open, how many orders it
 * holds, the search box, and — for a client — the one thing that starts an
 * order.
 */
export function OrdersHeaderView({ section }: { section: OrderSection }) {
    const t = useTranslations("App.orders")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    // The section counts for the tabs and the title pill, read from the same
    // stats the tiles show, so the two can never disagree
    const stats = useQuery(trpc.orders.stats.queryOptions())

    const { open } = useNewOrder()

    const orgType = session.organization.type
    const canCreate = orgType === "shipper"

    return (
        <>
            <PageHeader
                eyebrow={[t("eyebrow"), t(`sections.${section}`)]}
                title={t(`title.${section}`)}
                count={stats.data?.bySection[section]}
                description={t(`description.${section}.${orgType}`)}
                search={{
                    placeholder: t("filters.search"),
                    clearLabel: t("filters.clear"),
                }}
                below={<SectionTabs section={section} orgType={orgType} stats={stats.data} />}
                actions={canCreate ? (
                    <Button onClick={open}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("actions.new-order")}
                    </Button>
                ) : undefined}
            />

            {canCreate && <NewOrderSheet />}
        </>
    )
}
