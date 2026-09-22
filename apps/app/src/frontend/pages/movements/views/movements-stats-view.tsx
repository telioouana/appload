"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"

import { useTRPC } from "@/backend/api/client"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The money strip above the table, for the tab and section on screen:
 * revenue, costs and margin of the company's own rows, per currency —
 * never converted, never summed across two. The attention counts (silent,
 * off-route, disputed) live in the Filters popover, and the sections are
 * the rail's and the header's; nothing here navigates.
 */
export function MovementsStatsView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads.cashflow")
    const trpc = useTRPC()

    const { data: cashflow } = useSuspenseQuery(trpc.movements.cashflow.queryOptions({ scope, section }))

    const metrics: MoneyMetric[] = [
        { key: "revenue", label: t("revenue"), kind: "amount", tone: "positive" },
        { key: "costs", label: t("costs"), kind: "amount", tone: "negative" },
        { key: "margin", label: t("margin"), kind: "amount", tone: "signed", emphasis: true },
    ]

    const lines: MoneyLine[] = cashflow.lines.map((line) => ({
        currency: line.currency,
        values: { revenue: line.revenue, costs: line.costs, margin: line.margin },
    }))

    return <MoneyStrip title={t("title")} metrics={metrics} lines={lines} empty={t("empty")} />
}
