"use client"

import { IconInfoCircle } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Label } from "@workspace/ui/components/label"

import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import { DetailRow } from "@workspace/ui/customs/detail/section-card"
import { IncludesChips, money, snapshot } from "@/frontend/pages/order/sections/offers-card"
import type { OfferRow } from "@/frontend/pages/order/server/offers-procedures"

/**
 * Choosing which quote books the order. Only offers still awaiting a
 * decision can be picked — accepting is the decision — and one written
 * before pricing existed is shown, disabled, with the reason: hiding it
 * would leave the operator wondering where the quote went.
 *
 * The figures are the offer's own, saved when it was written and copied
 * onto the order at acceptance: the client price the shipper is quoted,
 * the carrier's price underneath, and Appload's commission between them.
 */
export function OfferPicker({
    offers,
    value,
    onChange,
}: {
    offers: OfferRow[]
    value: string | null
    onChange: (offerId: string) => void
}) {
    const t = useTranslations("Admin.orders.offers")
    const f = useFormatter()

    const pending = offers.filter((offer) => offer.status === "pending")
    const priced = (offer: OfferRow) => offer.commissionTotal !== null && offer.clientTotal !== null
    // An unpriced quote is listed but never chosen, so a value pointing at
    // one (an Accept clicked on the card) selects nothing
    const selected = pending.find((offer) => offer.id === value && priced(offer)) ?? null

    const share = selected !== null && Number(selected.clientTotal) > 0
        ? Number(selected.commissionTotal) / Number(selected.clientTotal)
        : null

    if (pending.length === 0) {
        return <p className="text-muted-foreground text-sm">{t("picker.empty")}</p>
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <Label>{t("picker.title")}</Label>

                <div role="radiogroup" className="flex flex-col gap-2">
                    {pending.map((offer) => {
                        const unpriced = !priced(offer)
                        const checked = offer.id === value && !unpriced

                        return (
                            <button
                                key={offer.id}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                disabled={unpriced}
                                onClick={() => onChange(offer.id)}
                                className={cn(
                                    "flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors",
                                    checked ? "border-primary bg-primary/5" : "hover:bg-muted",
                                    unpriced ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                                )}
                            >
                                <span className="flex min-w-0 flex-col gap-1">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        <span className="truncate text-sm font-medium">{offer.carrierName}</span>
                                        {offer.carrierKycStatus && offer.carrierKycStatus !== "verified" && (
                                            <KycBadge status={offer.carrierKycStatus} />
                                        )}
                                    </span>

                                    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                                        <IncludesChips git={offer.includesGit} gps={offer.includesGps} />
                                        <span aria-hidden>·</span>
                                        <span className="whitespace-nowrap">{snapshot(t, f, offer)}</span>
                                    </span>

                                    {unpriced && <span className="text-destructive text-xs">{t("picker.unpriced")}</span>}
                                </span>

                                <span className="flex shrink-0 flex-col items-end">
                                    <span className="text-sm font-medium tabular-nums">
                                        {money(f, offer.clientTotal ?? offer.total, offer.currency)}
                                    </span>
                                    {!unpriced && (
                                        <span className="text-muted-foreground text-[11px] tabular-nums">
                                            {t("commission.carrier")} {money(f, offer.total, offer.currency)}
                                        </span>
                                    )}
                                </span>
                            </button>
                        )
                    })}
                </div>

                <p className="text-muted-foreground text-xs">{t("picker.description")}</p>
            </div>

            {selected && (
                <dl className="bg-muted/30 flex flex-col gap-1.5 rounded-xl p-3">
                    <DetailRow label={t("picker.summary.shipper")}>
                        {money(f, selected.clientTotal, selected.currency)}
                    </DetailRow>

                    <DetailRow label={t("picker.summary.carrier")}>
                        {money(f, selected.total, selected.currency)}
                    </DetailRow>

                    <DetailRow label={t("picker.summary.commission")}>
                        <span className={cn(Number(selected.commissionTotal) < 0 && "text-destructive")}>
                            {money(f, selected.commissionTotal, selected.currency)}
                        </span>
                        {share !== null && (
                            <span className="text-muted-foreground text-xs">
                                {t("picker.summary.share", {
                                    percent: f.number(share, { style: "percent", maximumFractionDigits: 1 }),
                                })}
                            </span>
                        )}
                    </DetailRow>
                </dl>
            )}

            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <IconInfoCircle className="mt-px size-3.5 shrink-0" />
                {t("picker.hint")}
            </p>
        </div>
    )
}
