"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconAlertTriangle, IconCalendarTime, IconPencilMinus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"
import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"
import { rentalsListInput, type RentalMoneyLine } from "@/frontend/pages/rentals/types"

/**
 * The work queue above the table: the rentals running now, the ones asking
 * for a hand today — a disputed day, a driver who said no or did not answer
 * — and the drafts still to be activated. Under them, what the open rentals
 * come to per currency from where the company stands: what a client pays,
 * what a transporter is paid.
 */
export function RentalsStatsView() {
    const t = useTranslations("App.rentals.tiles")
    const tm = useTranslations("App.rentals.money")
    const trpc = useTRPC()
    const searchParams = useSearchParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])
    const { tab } = rentalsListInput(get)

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.rentals.stats.queryOptions({ tab }))

    const tiles: AttentionTile[] = [
        {
            filter: { key: "status", value: "active" },
            label: t("active"),
            value: stats.byState.active,
            hint: t("active-hint"),
            Icon: IconCalendarTime,
        },
        {
            filter: { key: "status", value: "active" },
            label: t("attention"),
            value: stats.attention.disputed + stats.attention.saidNo + stats.attention.silent,
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
        { key: "billable", label: tm("billable"), kind: "amount" },
        { key: shipper ? "paid" : "received", label: tm(shipper ? "paid" : "received"), kind: "amount", tone: "positive" },
        { key: shipper ? "outstanding" : "receivable", label: tm(shipper ? "outstanding" : "receivable"), kind: "amount", tone: "negative", emphasis: true },
    ]
    // A shipper's own rentals are what it pays its providers (no client half);
    // the ones it is the client on are billed to it by the owner, so what it
    // paid is what the owner received
    const valuesOf = (line: RentalMoneyLine): Record<string, number> => shipper
        ? tab === "own"
            ? { billable: line.payable, paid: line.paid, outstanding: line.outstanding }
            : { billable: line.billable, paid: line.received, outstanding: line.receivable }
        : { billable: line.billable, received: line.received, receivable: line.receivable }
    const lines: MoneyLine[] = stats.money.map((line) => ({ currency: line.currency, values: valuesOf(line) }))

    return (
        <div className="flex flex-col gap-5">
            <AttentionTiles tiles={tiles} />
            <MoneyStrip
                title={tm(shipper ? "spend" : "revenue")}
                metrics={metrics}
                lines={lines}
                empty={tm("empty")}
            />
        </div>
    )
}
