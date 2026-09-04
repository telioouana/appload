"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Switch } from "@workspace/ui/components/switch"

import { useTRPC } from "@/backend/api/client"
import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@/components/list/money-strip"
import { useListParams } from "@/components/list/use-list-params"
import { cashflowInput } from "@/frontend/pages/orders/types"

const SHIPPER_OUTSTANDING = [{ key: "paymentBy", value: "shipper" }, { key: "payment", value: "outstanding" }]
const CARRIER_OUTSTANDING = [{ key: "paymentBy", value: "carrier" }, { key: "payment", value: "outstanding" }]

/**
 * The year's cashflow above every section page, per currency: pending
 * payments per side, payables to carriers, receivables from shippers,
 * insurance Appload has to pay and what is left to come. Booked trips are
 * in or out with the switch; a column click opens the rows it counts on
 * the current page.
 */
export function OrdersStatsView() {
    const t = useTranslations("Admin.orders.list.cashflow")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const input = cashflowInput((key) => searchParams.get(key))
    const { data } = useSuspenseQuery(trpc.orders.cashflow.queryOptions(input))

    const metrics: MoneyMetric[] = [
        { key: "pendingCarrier", label: t("pending-carrier"), kind: "count", filter: CARRIER_OUTSTANDING },
        { key: "pendingShipper", label: t("pending-shipper"), kind: "count", filter: SHIPPER_OUTSTANDING },
        { key: "payables", label: t("payables"), kind: "amount", tone: "negative", filter: CARRIER_OUTSTANDING },
        { key: "receivables", label: t("receivables"), kind: "amount", tone: "positive", filter: SHIPPER_OUTSTANDING },
        { key: "insurance", label: t("insurance"), kind: "amount", tone: "negative", filter: [{ key: "insurance", value: "pending" }] },
        { key: "cashflow", label: t("cashflow"), kind: "amount", tone: "signed", emphasis: true },
    ]

    const lines: MoneyLine[] = data.lines.map((line) => ({
        currency: line.currency,
        values: {
            pendingCarrier: line.pendingCarrier,
            pendingShipper: line.pendingShipper,
            payables: line.payables,
            receivables: line.receivables,
            insurance: line.insurance,
            cashflow: line.cashflow,
        },
    }))

    const including = data.booked === "include"

    return (
        <MoneyStrip
            title={t("title", { year: data.year })}
            metrics={metrics}
            lines={lines}
            reset={["status"]}
            empty={t("empty")}
            control={
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Switch
                        size="sm"
                        checked={including}
                        onCheckedChange={(checked) => set({ key: "booked", value: checked ? null : "exclude" })}
                    />
                    <span className={including ? "text-foreground" : "text-muted-foreground"}>
                        {t(including ? "including" : "excluding")}
                    </span>
                </label>
            }
        />
    )
}
