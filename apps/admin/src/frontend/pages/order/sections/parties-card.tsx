"use client"

import { IconLock } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order, OrderDocument } from "@workspace/db/orders"

import { PaymentLedger } from "@/frontend/pages/order/components/payment-ledger"
import { PartyBlock } from "@/frontend/pages/orders/sections/order-item-parts"
import { effectiveCommission, effectiveTotals } from "@/lib/orders/totals"
import type { OfferRow } from "@/frontend/pages/order/server/offers-procedures"

import { IncludesChips } from "./offers-card"
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
    acceptedOffer,
    canRecordFor,
    heldFor,
    onRecord,
}: {
    order: Order
    documents: OrderDocument[]
    /** The offer that booked the order — what the carrier's price covers */
    acceptedOffer?: OfferRow | null
    canRecordFor: (party: "shipper" | "carrier") => boolean
    heldFor: (party: "shipper" | "carrier") => boolean
    onRecord: (party: "shipper" | "carrier") => void
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const tInsurance = useTranslations("Admin.order.update.form.insurance.fields")
    const f = useFormatter()

    const effective = effectiveTotals(order)
    const commission = effectiveCommission(order)

    const shipperAdjusted = Number(order.shipperDebitTotal) !== 0 || Number(order.shipperCreditTotal) !== 0
    const carrierAdjusted = Number(order.carrierDebitTotal) !== 0 || Number(order.carrierCreditTotal) !== 0

    const money = (value: number | null, currency: string | null) =>
        value === null ? null : `${f.number(value, { maximumFractionDigits: 0 })} ${currency ?? "MZN"}`

    // A ratio, not a percentage figure: the formatter writes the decimal
    // comma and the sign the locale asks for, which "8.3%" spelled out by
    // hand does not — it stayed English under a Portuguese page. It is taken
    // against the effective total, the one the cell to the left shows, so a
    // debit note moves the figure and its share together; and a commission
    // too small to reach a tenth of a percent reads 0%, never −0%.
    const shipperEffective = effective.shipperTotal
    const ratio = commission !== null && shipperEffective !== null && shipperEffective > 0
        ? commission / shipperEffective
        : null
    const share = ratio !== null && Math.abs(ratio) < 0.0005 ? 0 : ratio

    const insured = order.insuranceValue !== null && order.insuranceSubscriber === "appload"

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
                    includes={acceptedOffer ? { git: acceptedOffer.includesGit, gps: acceptedOffer.includesGps } : null}
                    canRecord={canRecordFor("carrier")}
                    held={heldFor("carrier")}
                    onRecord={() => onRecord("carrier")}
                />
            </div>

            <CellRow>
                <Cell
                    label={t("money.shipperTotal")}
                    caption={
                        <Note
                            base={shipperAdjusted ? money(Number(order.shipperTotal), order.shipperCurrency) : null}
                            adjustment={adjustment(order.shipperDebitTotal, order.shipperCreditTotal, f, t)}
                            fallback={t("money.in")}
                        />
                    }
                >
                    <Total value={money(effective.shipperTotal, order.shipperCurrency)} tone="in" />
                </Cell>

                <Cell
                    label={t("money.carrierTotal")}
                    caption={
                        <Note
                            base={carrierAdjusted ? money(Number(order.carrierTotal), order.carrierCurrency) : null}
                            adjustment={adjustment(order.carrierDebitTotal, order.carrierCreditTotal, f, t)}
                            fallback={t("money.out")}
                        />
                    }
                >
                    <Total value={money(effective.carrierTotal, order.carrierCurrency)} tone="out" />
                </Cell>

                <Cell
                    label={t("money.commission")}
                    caption={share === null ? null : t("money.share", {
                        percent: f.number(share, { style: "percent", maximumFractionDigits: 1 }),
                    })}
                >
                    <Total value={money(commission, order.shipperCurrency)} />
                </Cell>

                <Cell
                    label={t("money.insurance")}
                    caption={insured ? insuranceNote(order, tInsurance) : t("money.ownCover")}
                >
                    <Total value={insured ? money(Number(order.insuranceValue), order.insuranceCurrency) : null} />
                </Cell>
            </CellRow>
        </SectionCard>
    )
}

function Party({
    order,
    party,
    documents,
    includes,
    canRecord,
    held,
    onRecord,
    className,
}: {
    order: Order
    party: "shipper" | "carrier"
    documents: OrderDocument[]
    includes?: { git: boolean; gps: boolean } | null
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

            {/* What the accepted quote covers sits with the carrier's price,
                because that is what the price is for */}
            {includes && <IncludesChips git={includes.git} gps={includes.gps} />}

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

/** The figure itself, in the colour of the direction the money moves. */
function Total({ value, tone }: { value: string | null; tone?: "in" | "out" }) {
    if (value === null) return <span className="text-muted-foreground/60 font-normal">—</span>

    return (
        <span className={
            tone === "in" ? "text-emerald-600 dark:text-emerald-400"
                : tone === "out" ? "text-destructive"
                    : undefined
        }>
            {value}
        </span>
    )
}

/**
 * The line under a figure: the base struck through once notes have moved it
 * and the note that moved it, or — when neither applies — what the figure is.
 */
function Note({
    base,
    adjustment,
    fallback,
}: {
    base: string | null
    adjustment: string | null
    fallback: string
}) {
    if (!base && !adjustment) return <>{fallback}</>

    return (
        <>
            {base && <span className="line-through">{base}</span>}
            {base && adjustment && " · "}
            {adjustment}
        </>
    )
}

/** Who wrote the cover and where it stands, when Appload wrote it. */
function insuranceNote(order: Order, t: ReturnType<typeof useTranslations<"Admin.order.update.form.insurance.fields">>) {
    const subscriber = t("subscriber.options.appload")

    return order.insuranceStatus
        ? `${subscriber} · ${t(`status.options.${order.insuranceStatus}` as never)}`
        : subscriber
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
