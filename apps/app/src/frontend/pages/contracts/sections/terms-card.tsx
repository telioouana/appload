"use client"

import { IconAlertTriangle } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"

import { PriceModelText, ProgressBar, unitOf, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import type { ContractDetail } from "@/frontend/pages/contracts/types"
import { place } from "@/frontend/pages/movements/components/badges"

/**
 * What was agreed: what the contract counts and how much of it, how far
 * along it is, when and where it runs, who it is with, and what it is
 * priced at. A transporter reads its own share's figures here (the server
 * sized them) and never the client's price.
 */
export function TermsCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts")
    const tv = useTranslations("App.orders")
    const f = useFormatter()
    const unitLabel = useUnitLabel()

    const owner = contract.role === "owner"
    const unit = unitOf(contract.basis)
    // An open-ended figure has no number to print
    const qty = (value: number | null) => value === null ? <span className="text-muted-foreground">{t("values.open")}</span> : unitLabel(unit, value)
    const date = (value: string) => f.dateTime(new Date(value), { dateStyle: "medium" })

    // The owner promised more to its transporters than the client asked for
    // — only readable when the contract and every share have a figure
    const shares = contract.allocations.map((share) => share.shareQty)
    const allocated = shares.reduce<number>((sum, share) => sum + (share ?? 0), 0)
    const overAllocated = owner && contract.committedQty !== null && shares.every((share) => share !== null) && allocated > contract.committedQty

    return (
        <SectionCard title={t("detail.terms")}>
            <dl className="flex flex-col gap-2">
                <DetailRow label={t("detail.fields.basis")}>{t(`basis.${contract.basis}`)}</DetailRow>
                <DetailRow label={t("detail.fields.commitment")}>{qty(contract.committedQty)}</DetailRow>

                <div className="flex flex-col gap-1.5 pt-1">
                    <ProgressBar consumed={contract.progress.consumed} total={contract.committedQty} unit={unit} />
                    {overAllocated && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <IconAlertTriangle className="size-3" stroke={1.5} />
                            {t("detail.over-allocated")}
                        </span>
                    )}
                </div>

                <DetailRow label={t("detail.fields.drawn-down")}>{qty(contract.progress.consumed)}</DetailRow>
                <DetailRow label={t("detail.fields.delivered")}>{qty(contract.progress.delivered)}</DetailRow>
                <DetailRow label={t("detail.fields.remaining")}>{qty(contract.progress.remaining)}</DetailRow>
            </dl>

            <dl className="flex flex-col gap-2 border-t pt-3.5">
                <DetailRow label={t("detail.fields.period")}>{date(contract.startsOn)} – {date(contract.endsOn)}</DetailRow>
                <DetailRow label={t("detail.fields.lane")}>
                    {contract.origin && contract.destination
                        ? `${place(contract.origin)} → ${place(contract.destination)}`
                        : <span className="text-muted-foreground">{t("values.any-lane")}</span>}
                </DetailRow>

                {!owner && <DetailRow label={t("detail.fields.owner")}>{contract.owner.name}</DetailRow>}

                {/* Who the transporter moves for is the owner's business */}
                {contract.role !== "carrier" && (
                    <DetailRow label={t("detail.fields.client")}>
                        {contract.client ? (
                            <>
                                <span className="truncate">{contract.client.name ?? "—"}</span>
                                {contract.client.id === null && (
                                    <Badge variant="outline" className="shrink-0 rounded-full font-normal">{t("values.typed")}</Badge>
                                )}
                            </>
                        ) : <span className="text-muted-foreground">{t("values.own-account")}</span>}
                    </DetailRow>
                )}

                {contract.clientReference && (
                    <DetailRow label={t("detail.fields.client-reference")}>{contract.clientReference}</DetailRow>
                )}
            </dl>

            <dl className="flex flex-col gap-2 border-t pt-3.5">
                <DetailRow label={t("detail.fields.currency")}>{tv(`currency.${contract.currency}`)}</DetailRow>
                {contract.fiscalRegime && (
                    <DetailRow label={t("detail.fields.fiscal-regime")}>{tv(`fiscalRegime.${contract.fiscalRegime}`)}</DetailRow>
                )}
                {contract.role !== "carrier" && (
                    <DetailRow label={t("detail.fields.sell-price")}>
                        {contract.sellPrice
                            ? <PriceModelText model={contract.sellPrice} currency={contract.currency} />
                            : <EmptyValue label={t("price-models.none")} />}
                    </DetailRow>
                )}
            </dl>
        </SectionCard>
    )
}
