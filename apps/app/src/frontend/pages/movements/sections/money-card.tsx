"use client"

import { useState } from "react"
import { IconCash } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash } from "@workspace/ui/customs/list/table-cells"

import { useMoney } from "@/frontend/pages/movements/components/badges"
import { PaymentDialog } from "@/frontend/pages/movements/sections/payment-dialog"
import type { MarginView, MoneyLeg, MovementDetail } from "@/frontend/pages/movements/types"

/**
 * What the load is worth to the reader, in the reader's own terms: what it
 * will be paid and what it will pay, each in its own currency, and — for the
 * owner — the margin between them. The two legs are never converted into
 * one another: a load bought in rand and sold in meticais shows both, and no
 * margin, rather than a number resting on an exchange rate nobody agreed.
 */
export function MoneyCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.money")

    const [paying, setPaying] = useState(false)

    const { payable, receivable, margin } = load.money
    const owner = load.role === "owner"

    return (
        <SectionCard
            title={t("title")}
            actions={load.permissions.canRecordPayment ? (
                <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                    <IconCash className="size-4" stroke={1.5} />
                    {t("record")}
                </Button>
            ) : undefined}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                {receivable && (
                    <LegBlock
                        title={t(owner ? "receivable.owner" : "receivable.executor")}
                        leg={receivable}
                        settledLabel={t("received")}
                    />
                )}
                {payable && (
                    <LegBlock
                        title={t(owner ? "payable.owner" : "payable.client")}
                        leg={payable}
                        settledLabel={t("paid")}
                    />
                )}
            </div>

            {owner && !receivable && !payable && <p className="text-muted-foreground text-sm">{t("no-legs")}</p>}

            {/* With no price on either side there is no margin to explain */}
            {margin && (receivable || payable) && <MarginBlock margin={margin} />}

            {paying && <PaymentDialog load={load} onClose={() => setPaying(false)} />}
        </SectionCard>
    )
}

function LegBlock({ title, leg, settledLabel }: { title: string; leg: MoneyLeg; settledLabel: string }) {
    const t = useTranslations("App.loads.money")
    const tv = useTranslations("App.orders")
    const f = useFormatter()
    const money = useMoney()

    const share = leg.total > 0 ? Math.min(100, (leg.settled / leg.total) * 100) : 0

    return (
        <div className="bg-muted/40 flex flex-col gap-2.5 rounded-xl px-4 py-3">
            <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium">{title}</span>
                <Badge variant={leg.settlement === "completed" ? "default" : "outline"} className="rounded-full font-normal">
                    {t(`settlement.${leg.settlement}`)}
                </Badge>
            </div>

            <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                {money(leg.total, leg.currency)}
            </span>

            <div className="flex flex-col gap-1">
                <Progress value={share} className="h-1.5" />
                <span className="text-muted-foreground text-xs tabular-nums">
                    {settledLabel}: {money(leg.settled, leg.currency)}
                </span>
            </div>

            <dl className="flex flex-col gap-1.5">
                {leg.subtotal !== null && (
                    <DetailRow label={t("subtotal")}>{money(leg.subtotal, leg.currency)}</DetailRow>
                )}
                {leg.vat !== null && <DetailRow label={t("vat")}>{money(leg.vat, leg.currency)}</DetailRow>}
                <DetailRow label={t("fiscal-regime")}>
                    {leg.fiscalRegime ? tv(`fiscalRegime.${leg.fiscalRegime}`) : <Dash />}
                </DetailRow>
                <DetailRow label={t("invoice")}>
                    {leg.invoiceNumber
                        ? `${leg.invoiceNumber}${leg.invoiceDate ? ` · ${f.dateTime(leg.invoiceDate, { dateStyle: "medium" })}` : ""}`
                        : <Dash />}
                </DetailRow>
            </dl>
        </div>
    )
}

function MarginBlock({ margin }: { margin: MarginView }) {
    const t = useTranslations("App.loads.money")
    const money = useMoney()

    return (
        <div className="flex flex-col gap-2 border-t pt-3.5">
            <dl className="flex flex-col gap-2">
                <DetailRow label={t("gross")}>
                    {margin.gross ? money(margin.gross.amount, margin.gross.currency) : <Dash />}
                </DetailRow>
                <DetailRow label={t("net")}>
                    {margin.net
                        ? <span className={margin.net.amount < 0 ? "text-destructive" : undefined}>{money(margin.net.amount, margin.net.currency)}</span>
                        : <Dash />}
                </DetailRow>
                {margin.costs.map((cost) => (
                    <DetailRow key={cost.currency} label={t("costs", { currency: cost.currency })}>
                        {cost.rechargeable > 0 && (
                            <span className="text-muted-foreground text-xs">
                                {t("rechargeable-part", { amount: money(cost.rechargeable, cost.currency) })}
                            </span>
                        )}
                        {money(cost.total, cost.currency)}
                    </DetailRow>
                ))}
            </dl>

            {margin.blocked && <p className="text-muted-foreground text-xs">{t(`blocked.${margin.blocked}`)}</p>}
        </div>
    )
}
