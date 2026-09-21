"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconGavel, IconMapPinExclamation, IconRouteOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"
import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"

import { useTRPC } from "@/backend/api/client"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The stats above the table, for the tab and section on screen: the money
 * strip — revenue, costs and margin of the company's own rows, per
 * currency — and the attention tiles, each counting the rows that need a
 * hand and filtering the list to exactly those when clicked. The sections
 * themselves are the rail's and the header's; nothing here navigates.
 */
export function MovementsStatsView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads")
    const trpc = useTRPC()

    const { data: stats } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope }))
    const { data: cashflow } = useSuspenseQuery(trpc.movements.cashflow.queryOptions({ scope, section }))

    const metrics: MoneyMetric[] = [
        { key: "revenue", label: t("cashflow.revenue"), kind: "amount", tone: "positive" },
        { key: "costs", label: t("cashflow.costs"), kind: "amount", tone: "negative" },
        { key: "margin", label: t("cashflow.margin"), kind: "amount", tone: "signed", emphasis: true },
    ]

    const lines: MoneyLine[] = cashflow.lines.map((line) => ({
        currency: line.currency,
        values: { revenue: line.revenue, costs: line.costs, margin: line.margin },
    }))

    const tiles: AttentionTile[] = [
        { filter: { key: "silent", value: "1" }, label: t("tiles.silent"), value: stats.silent, hint: t("tiles.silent-hint"), Icon: IconMapPinExclamation },
        { filter: { key: "offRoute", value: "1" }, label: t("tiles.off-route"), value: stats.offRoute, hint: t("tiles.off-route-hint"), Icon: IconRouteOff },
        { filter: { key: "disputed", value: "1" }, label: t("tiles.disputed"), value: stats.bySection.disputes ?? 0, hint: t("tiles.disputed-hint"), Icon: IconGavel },
    ]

    return (
        <div className="flex flex-col gap-4">
            <MoneyStrip title={t("cashflow.title")} metrics={metrics} lines={lines} empty={t("cashflow.empty")} />
            <AttentionTiles tiles={tiles} reset={["status"]} />
        </div>
    )
}
