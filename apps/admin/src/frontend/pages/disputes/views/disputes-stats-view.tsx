"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { MoneyStrip, type MoneyMetric } from "@/components/list/money-strip"

/** What is at stake on the active disputes: how many, and the money claimed per currency. */
export function DisputesStatsView() {
    const t = useTranslations("Admin.disputes.stats")
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.disputes.stats.queryOptions())

    const metrics: MoneyMetric[] = [
        { key: "count", label: t("count"), kind: "count" },
        { key: "claimed", label: t("claimed"), kind: "amount", tone: "negative", emphasis: true },
    ]

    return (
        <MoneyStrip
            title={t("title", { open: data.byStatus.open, review: data.byStatus["under-review"] })}
            metrics={metrics}
            lines={data.claimed.map((line) => ({ currency: line.currency, values: { count: line.count, claimed: line.amount } }))}
            empty={t("empty")}
        />
    )
}
