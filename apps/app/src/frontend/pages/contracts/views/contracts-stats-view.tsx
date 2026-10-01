"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconAlertTriangle, IconFileCheck, IconPencilMinus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"
import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"
import { contractsListInput } from "@/frontend/pages/contracts/types"

/**
 * The work queue above the table: the contracts taking trips, the ones that
 * ran out on their own — used up, or past their end date — and the drafts
 * still to be activated. Each tile opens the rows it counted; the middle one
 * counts two derived states but opens the used-up ones, the ones that ask
 * for a decision rather than just a new date. Under them, what the standing
 * contracts come to per currency — what a client pays, what a transporter is
 * paid — and the same in meticais at the newest rate on file.
 */
export function ContractsStatsView() {
    const t = useTranslations("App.contracts.tiles")
    const tm = useTranslations("App.contracts.money")
    const trpc = useTRPC()
    const searchParams = useSearchParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])
    const { tab } = contractsListInput(get)

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.contracts.stats.queryOptions({ tab }))

    const tiles: AttentionTile[] = [
        {
            filter: { key: "status", value: "active" },
            label: t("active"),
            value: stats.byState.active,
            hint: t("active-hint"),
            Icon: IconFileCheck,
        },
        {
            filter: { key: "status", value: "exhausted" },
            label: t("attention"),
            value: stats.byState.exhausted + stats.byState.expired,
            hint: t("attention-hint"),
            Icon: IconAlertTriangle,
        },
        {
            filter: { key: "status", value: "draft" },
            label: t("draft"),
            value: stats.byState.draft,
            hint: t("draft-hint"),
            Icon: IconPencilMinus,
        },
    ]

    const shipper = session.organization.type === "shipper"
    // A client reads what it has paid and still owes; a transporter what it was paid and is still owed
    const metrics: MoneyMetric[] = [
        { key: "committed", label: tm("committed"), kind: "amount" },
        { key: "drawn", label: tm("drawn"), kind: "amount" },
        { key: "remaining", label: tm("remaining"), kind: "amount" },
        { key: shipper ? "paid" : "received", label: tm(shipper ? "paid" : "received"), kind: "amount", tone: "positive" },
        { key: shipper ? "outstanding" : "receivable", label: tm(shipper ? "outstanding" : "receivable"), kind: "amount", tone: "negative", emphasis: true },
    ]
    const lines: MoneyLine[] = stats.money.lines.map(({ currency, ...values }) => ({ currency, values }))
    // The converted line only says something with two currencies, or one that is not the metical
    if (stats.money.total && !(lines.length === 1 && lines[0]?.currency === "MZN")) {
        const { rateDay: _rateDay, currency: _currency, ...values } = stats.money.total
        lines.push({ currency: tm("approx"), values })
    }

    return (
        <div className="flex flex-col gap-5">
            <AttentionTiles tiles={tiles} />
            <MoneyStrip
                title={tm(session.organization.type === "shipper" ? "spend" : "revenue")}
                metrics={metrics}
                lines={lines}
                empty={tm("empty")}
            />
        </div>
    )
}
