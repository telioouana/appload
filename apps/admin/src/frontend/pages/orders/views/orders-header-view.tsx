"use client"

import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconBuildingFactory2, IconBuildingWarehouse, IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader, type SuggestionGroup } from "@workspace/ui/customs/list/page-header"
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order"
import { currentYear, ordersListInput, type Section } from "@/frontend/pages/orders/types"

// Accent-insensitive: "Zambezia" finds "Zambézia"
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

const MAX_SUGGESTIONS = 5

/**
 * Title, count and search for one section; "New order" opens the sheet the
 * sidebar mounts. Typing a party's name offers it as a quick filter: the
 * parties come from this year's orders (the same list the chips read), so
 * every suggestion opens a non-empty result.
 */
export function OrdersHeaderView({ section }: { section: Section }) {
    const t = useTranslations("Admin.orders")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { onOpenChange } = useCreateOrder()

    const year = ordersListInput(section, (key) => searchParams.get(key)).year ?? currentYear()
    const { data: stats } = useQuery(trpc.orders.stats.queryOptions({ year }))
    const { data: options } = useQuery(trpc.orders.filterOptions.queryOptions({ year }))

    const count = stats ? (section === "all" ? stats.total : stats.bySection[section]) : undefined

    // One party at a time: picking a shipper drops a carrier filter and vice versa
    const party = (key: "shipper" | "carrier", id: string) => [
        { key, value: id },
        { key: key === "shipper" ? "carrier" : "shipper", value: null },
    ]

    const groups = (query: string): SuggestionGroup[] => {
        const term = normalize(query)
        const matching = <T extends { name: string }>(entries: T[] | undefined) =>
            (entries ?? []).filter((entry) => normalize(entry.name).includes(term)).slice(0, MAX_SUGGESTIONS)

        return [
            {
                heading: t("list.suggest.shippers"),
                items: matching(options?.shippers).map((entry) => ({
                    id: `shipper-${entry.id}`,
                    label: entry.name,
                    hint: t("list.suggest.orders", { count: entry.count }),
                    Icon: IconBuildingFactory2,
                    params: party("shipper", entry.id),
                })),
            },
            {
                heading: t("list.suggest.carriers"),
                items: matching(options?.carriers).map((entry) => ({
                    id: `carrier-${entry.id}`,
                    label: entry.name,
                    hint: t("list.suggest.orders", { count: entry.count }),
                    Icon: IconBuildingWarehouse,
                    params: party("carrier", entry.id),
                })),
            },
        ]
    }

    return (
        <PageHeader
            eyebrow={[t("list.eyebrow"), t("list.title"), t(`list.pages.${section}.title`)]}
            title={t(`list.pages.${section}.title`)}
            count={count}
            description={t(`list.pages.${section}.description`)}
            search={{
                placeholder: t("header.search"),
                clearLabel: t("list.clear-search"),
                suggestions: {
                    groups,
                    searchLabel: (query) => t("list.suggest.search", { query }),
                },
            }}
            actions={
                <Button onClick={onOpenChange}>
                    <IconPlus className="size-4" stroke={1.5} />
                    {t("list.new")}
                </Button>
            }
        />
    )
}
