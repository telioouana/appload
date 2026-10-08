"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"

import { localDate } from "@/frontend/pages/rentals/lib/dates"
import type { RentalDetail } from "@/frontend/pages/rentals/types"
import { place, useMoney } from "@/frontend/pages/movements/components/badges"

/**
 * What was agreed: the day rate and which days count, where and when the
 * trucks work, who it is with. A provider reads no price here — its own is
 * on its line — and never who the client is.
 */
export function TermsCard({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals")
    const tv = useTranslations("App.orders")
    const f = useFormatter()
    const money = useMoney()

    const owner = rental.role === "owner"
    const price = rental.sellPrice
    const date = (iso: string) => f.dateTime(localDate(iso), { dateStyle: "medium" })

    return (
        <SectionCard title={t("detail.terms")}>
            {price && (
                <dl className="flex flex-col gap-2">
                    <DetailRow label={t("detail.fields.rate")}>{t("values.per-day", { amount: money(price.rate, rental.currency) })}</DetailRow>
                    <DetailRow label={t("detail.fields.billable-days")}>{t(`values.${price.billableDays}`)}</DetailRow>
                    {price.standbyRate !== undefined && (
                        <DetailRow label={t("detail.fields.standby-rate")}>{t("values.standby-rate", { amount: money(price.standbyRate, rental.currency) })}</DetailRow>
                    )}
                </dl>
            )}

            <dl className={`flex flex-col gap-2 ${price ? "border-t pt-3.5" : ""}`}>
                <DetailRow label={t("detail.fields.site")}>
                    {rental.site ? place(rental.site) : <span className="text-muted-foreground">{t("values.no-site")}</span>}
                </DetailRow>
                <DetailRow label={t("detail.fields.period")}>
                    {rental.endsOn === null ? t("values.since", { date: date(rental.startsOn) }) : `${date(rental.startsOn)} – ${date(rental.endsOn)}`}
                </DetailRow>

                {!owner && <DetailRow label={t("detail.fields.owner")}>{rental.owner.name}</DetailRow>}

                {rental.role !== "carrier" && (
                    <DetailRow label={t("detail.fields.client")}>
                        {rental.client ? (
                            <>
                                <span className="truncate">{rental.client.name ?? "—"}</span>
                                {rental.client.id === null && (
                                    <Badge variant="outline" className="shrink-0 rounded-full font-normal">{t("values.typed")}</Badge>
                                )}
                            </>
                        ) : <span className="text-muted-foreground">{t("values.no-client")}</span>}
                    </DetailRow>
                )}

                {rental.clientReference && <DetailRow label={t("detail.fields.client-reference")}>{rental.clientReference}</DetailRow>}
            </dl>

            <dl className="flex flex-col gap-2 border-t pt-3.5">
                <DetailRow label={t("detail.fields.currency")}>{tv(`currency.${rental.currency}`)}</DetailRow>
                {rental.fiscalRegime && <DetailRow label={t("detail.fields.fiscal-regime")}>{tv(`fiscalRegime.${rental.fiscalRegime}`)}</DetailRow>}
                <DetailRow label={t("detail.fields.trucks")}>{t("values.trucks", { count: rental.lines.length })}</DetailRow>
            </dl>
        </SectionCard>
    )
}
