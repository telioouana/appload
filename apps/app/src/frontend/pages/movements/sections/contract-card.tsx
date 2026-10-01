"use client"

import { useTranslations } from "@workspace/i18n"

import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Mono } from "@workspace/ui/customs/list/table-cells"

import { Link } from "@/i18n/navigation"
import { ContractStateChip, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import type { ContractSummary } from "@/frontend/pages/contracts/server/projection"

/**
 * The contract a load was filed under, as far as the reader may see it: the
 * owner and the transporter on the share read it, a client the owner is
 * moving the load for does not (the server sends nothing then, and the card
 * is not rendered). The remaining figure is the share's, read off the live
 * trips every time — the load's own place in it is one of them.
 */
export function ContractCard({ contract }: { contract: ContractSummary }) {
    const t = useTranslations("App.loads.detail.contract")
    const unit = useUnitLabel()

    return (
        <SectionCard title={t("title")}>
            <dl className="flex flex-col gap-2">
                <DetailRow label={t("contract")}>
                    <Link
                        href={{ pathname: "/contracts/[contractId]", params: { contractId: contract.id } }}
                        className="hover:underline"
                    >
                        <Mono>{contract.ref}</Mono>
                    </Link>
                </DetailRow>
                <DetailRow label={t("with")}>
                    {contract.counterparty ?? <span className="text-muted-foreground">{t("own-fleet")}</span>}
                </DetailRow>
                <DetailRow label={t("state")}>
                    <ContractStateChip state={contract.state} />
                </DetailRow>
                <DetailRow label={t("remaining")}>
                    {contract.remaining === null
                        ? <span className="text-muted-foreground">{t("open")}</span>
                        : contract.remaining > 0
                            ? unit(contract.unit, contract.remaining)
                            : <span className="text-amber-700">{t("used-up")}</span>}
                </DetailRow>
            </dl>
        </SectionCard>
    )
}
