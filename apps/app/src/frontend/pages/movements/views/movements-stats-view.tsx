"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { MoneyStrip, type MoneyLine, type MoneyMetric } from "@workspace/ui/customs/list/money-strip"

import { useTRPC } from "@/backend/api/client"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The money strip above the table, for the tab and section on screen, per
 * currency — never converted, never summed across two. A transporter reads
 * its own rows' revenue, costs and margin, then the cash still to receive
 * (and, on the partners tab, to pay). A client earns nothing on a load: on
 * its own trucks it reads what they cost, and on its transporters what the
 * freight comes to, what it has paid and what it still owes. The attention counts
 * (silent, off-route, disputed) live in the Filters popover, and the sections
 * are the rail's and the header's; nothing here navigates.
 */
export function MovementsStatsView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads.cashflow")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: cashflow } = useSuspenseQuery(trpc.movements.cashflow.queryOptions({ scope, section }))

    const shipper = session.organization.type === "shipper"
    // My trucks: an own-fleet load pays no transporter, so nothing is ever to pay there
    const fleet = scope === "trips"

    const [title, metrics]: [string, MoneyMetric[]] = shipper
        ? fleet
            ? [t("fleetCosts"), [{ key: "costs", label: t("costs"), kind: "amount", tone: "negative", emphasis: true }]]
            : [t("spend"), [
                { key: "freight", label: t("freight"), kind: "amount" },
                { key: "paid", label: t("paid"), kind: "amount", tone: "positive" },
                { key: "payable", label: t("payable"), kind: "amount", tone: "negative", emphasis: true },
            ]]
        : [t("title"), [
            { key: "revenue", label: t("revenue"), kind: "amount", tone: "positive" },
            { key: "costs", label: t("costs"), kind: "amount", tone: "negative" },
            { key: "margin", label: t("margin"), kind: "amount", tone: "signed", emphasis: true },
            { key: "receivable", label: t("receivable"), kind: "amount", tone: "positive" },
            ...(fleet ? [] : [{ key: "payable", label: t("payable"), kind: "amount", tone: "negative" } satisfies MoneyMetric]),
        ]]

    const lines: MoneyLine[] = cashflow.lines.map(({ currency, ...values }) => ({
        currency,
        values: { ...values, freight: values.payable + values.paid },
    }))

    return <MoneyStrip title={title} metrics={metrics} lines={lines} empty={t("empty")} />
}
