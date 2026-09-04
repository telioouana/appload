"use client"

import { IconLock } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order, OrderDocument } from "@workspace/db/orders"

import { PaymentLedger } from "@/frontend/pages/order/components/payment-ledger"
import { PartyBlock } from "@/frontend/pages/orders/sections/order-item-parts"
import { effectiveCommission, effectiveTotals } from "@/lib/orders/totals"

import { Cell, CellRow, SectionCard } from "./section-card"

/**
 * Both sides of the money, side by side: what the shipper owes and what the
 * carrier is owed, each with its proofs, then one row of totals — in, out,
 * commission, insurance. When debit or credit notes exist the effective
 * figure leads and the base is struck through under it, so the two numbers
 * the operator has to reconcile are never on different screens.
 */
export function PartiesCard({
    order,
    documents,
    canRecordFor,
    heldFor,
    onRecord,
}: {
    order: Order
    documents: OrderDocument[]
    canRecordFor: (party: "shipper" | "carrier") => boolean
    heldFor: (party: "shipper" | "carrier") => boolean
    onRecord: (party: "shipper" | "carrier") => void
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const f = useFormatter()

    const effective = effectiveTotals(order)
    const commission = effectiveCommission(order)

    const shipperAdjusted = Number(order.shipperDebitTotal) !== 0 || Number(order.shipperCreditTotal) !== 0
    const carrierAdjusted = Number(order.carrierDebitTotal) !== 0 || Number(order.carrierCreditTotal) !== 0

    const money = (value: number | null, currency: string | null) =>
        value === null ? null : `${f.number(value, { maximumFractionDigits: 0 })} ${currency ?? "MZN"}`

    const share = commission !== null && Number(order.shipperTotal) > 0
        ? Math.round((commission / Number(order.shipperTotal)) * 1000) / 10
        : null

    return (
        <SectionCard title={t("sections.payments")} aside={t("money.vat")}>
            {/* The rule is drawn outside the flow rather than as a border on
                one column: a border would eat a pixel of that column's width
                and leave the two halves subtly different sizes */}
            <div className="relative grid gap-5 sm:grid-cols-2 sm:gap-x-10">
                <span aria-hidden className="bg-border absolute inset-y-0 left-1/2 hidden w-px sm:block" />

                <Party
                    order={order}
                    party="shipper"
                    documents={documents}
                    canRecord={canRecordFor("shipper")}
                    held={heldFor("shipper")}
                    onRecord={() => onRecord("shipper")}
                />
                <Party
                    order={order}
                    party="carrier"
                    documents={documents}
                    canRecord={canRecordFor("carrier")}
                    held={heldFor("carrier")}
                    onRecord={() => onRecord("carrier")}
                />
            </div>

            <CellRow>
                <Cell label={t("money.shipperTotal")}>
                    <Total
                        value={money(effective.shipperTotal, order.shipperCurrency)}
                        base={shipperAdjusted ? money(Number(order.shipperTotal), order.shipperCurrency) : null}
                        adjustment={adjustment(order.shipperDebitTotal, order.shipperCreditTotal, f, t)}
                        caption={t("money.in")}
                        tone="in"
                    />
                </Cell>

                <Cell label={t("money.carrierTotal")}>
                    <Total
                        value={money(effective.carrierTotal, order.carrierCurrency)}
                        base={carrierAdjusted ? money(Number(order.carrierTotal), order.carrierCurrency) : null}
                        adjustment={adjustment(order.carrierDebitTotal, order.carrierCreditTotal, f, t)}
                        caption={t("money.out")}
                        tone="out"
                    />
                </Cell>

                <Cell label={t("money.commission")}>
                    <Total
                        value={money(commission, order.shipperCurrency)}
                        base={null}
                        adjustment={null}
                        caption={share !== null ? t("money.share", { percent: share }) : undefined}
                    />
                </Cell>

                <Cell label={t("money.insurance")}>
                    <Insurance order={order} money={money} />
                </Cell>
            </CellRow>
        </SectionCard>
    )
}

function Party({
    order,
    party,
    documents,
    canRecord,
    held,
    onRecord,
    className,
}: {
    order: Order
    party: "shipper" | "carrier"
    documents: OrderDocument[]
    canRecord: boolean
    held: boolean
    onRecord: () => void
    className?: string
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const prospect = order.status === "prospect"

    return (
        <div className={cn("flex h-full flex-col gap-3", className)}>
            <PartyBlock order={order} party={party} layout="stacked" showPaid={!prospect} />

            {/* Pushed to the foot of the column so the two proof boxes line
                up even when one party's block above them runs a line longer */}
            <div className="mt-auto flex flex-col gap-3">
                {prospect ? (
                    <p className="text-muted-foreground text-xs italic">{t("payments.prospectHint")}</p>
                ) : (
                    <>
                        {held && (
                            <p className="text-destructive flex items-center gap-1.5 text-xs">
                                <IconLock className="size-3.5" />
                                {t("payments.heldHint")}
                            </p>
                        )}

                        <PaymentLedger
                            party={party}
                            documents={documents}
                            currency={party === "shipper" ? order.shipperCurrency : order.carrierCurrency}
                            canRecord={canRecord}
                            onRecord={onRecord}
                        />
                    </>
                )}
            </div>
        </div>
    )
}

function Total({
    value,
    base,
    adjustment,
    caption,
    tone,
}: {
    value: string | null
    base: string | null
    adjustment: string | null
    caption?: string
    tone?: "in" | "out"
}) {
    return (
        <>
            <span className={
                tone === "in" ? "text-emerald-600 dark:text-emerald-400"
                    : tone === "out" ? "text-destructive"
                        : undefined
            }>
                {value ?? <span className="text-muted-foreground/60 font-normal">—</span>}
            </span>

            {(base || caption || adjustment) && (
                <span className="text-muted-foreground mt-0.5 block text-[11px] font-normal">
                    {base && <span className="line-through">{base}</span>}
                    {base && adjustment && " · "}
                    {adjustment ?? (base ? null : caption)}
                </span>
            )}
        </>
    )
}

function Insurance({
    order,
    money,
}: {
    order: Order
    money: (value: number | null, currency: string | null) => string | null
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const tInsurance = useTranslations("Admin.order.update.form.insurance.fields")

    if (order.insuranceValue === null || order.insuranceSubscriber !== "appload") {
        return (
            <>
                <span className="text-muted-foreground/60 font-normal">—</span>
                <span className="text-muted-foreground mt-0.5 block text-[11px] font-normal">
                    {t("money.ownCover")}
                </span>
            </>
        )
    }

    return (
        <>
            {money(Number(order.insuranceValue), order.insuranceCurrency)}
            <span className="text-muted-foreground mt-0.5 block text-[11px] font-normal">
                {tInsurance("subscriber.options.appload")}
                {order.insuranceStatus && ` · ${tInsurance(`status.options.${order.insuranceStatus}` as never)}`}
            </span>
        </>
    )
}

/** "+25,000 debit note" / "−8,000 credit note", whichever applies. */
function adjustment(
    debit: string,
    credit: string,
    f: ReturnType<typeof useFormatter>,
    t: ReturnType<typeof useTranslations<"Admin.orders.detailPage">>,
): string | null {
    const debited = Number(debit)
    const credited = Number(credit)

    if (debited !== 0) return t("money.debit", { amount: f.number(debited, { maximumFractionDigits: 0 }) })
    if (credited !== 0) return t("money.credit", { amount: f.number(credited, { maximumFractionDigits: 0 }) })

    return null
}
