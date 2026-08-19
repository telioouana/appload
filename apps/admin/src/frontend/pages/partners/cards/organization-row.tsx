"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { EmptyValue, LabeledField } from "@/components/list/labeled-field"
import { useKycReview } from "@/frontend/pages/kyc/hooks/use-kyc-review"
import { initials, PartnerRow, trackSpan } from "@/frontend/pages/partners/cards/partner-row"
import type { OrgRow, VIEW } from "@/frontend/pages/partners/types"
import {
    ContractChip,
    DocProgressChip,
    ExpiryHint,
    KycBadge,
    RiskBadge,
} from "@/frontend/pages/partners/sections/badges"

export function OrganizationRow({
    organization,
    view,
    today,
}: {
    organization: OrgRow
    view: VIEW
    today: string
}) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()
    const { onOpen } = useKycReview()

    const isCarrier = organization.type === "carrier"
    const percent = (value: number | null) =>
        value === null ? null : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    return (
        <PartnerRow
            view={view}
            name={organization.name}
            image={organization.logo}
            fallback={initials(organization.name)}
            meta={organization.city ?? organization.email}
            badges={
                <>
                    <KycBadge status={organization.kycStatus} />
                    <RiskBadge level={organization.riskLevel} reason={organization.riskReason} />
                    {organization.contract && <ContractChip state={organization.contract} />}
                </>
            }
            onReview={() => onOpen({
                subjectType: "organization",
                subjectId: organization.id,
                title: organization.name,
                subtitle: organization.nuit,
            })}
            fields={
                <>
                    <LabeledField label={t("fields.nuit")} className={trackSpan(view, "xl:col-span-2")}>
                        <span className="tabular-nums">{organization.nuit}</span>
                    </LabeledField>

                    <LabeledField label={t("fields.phone")} className={trackSpan(view, "xl:col-span-2")}>
                        <span className="tabular-nums">{organization.phoneNumber}</span>
                    </LabeledField>

                    <LabeledField label={t("fields.documents")} className={trackSpan(view, "xl:col-span-2")}>
                        <div className="flex flex-col gap-0.5">
                            <DocProgressChip progress={organization.progress} />
                            <ExpiryHint date={organization.nextExpiry} today={today} />
                        </div>
                    </LabeledField>

                    <LabeledField label={t("fields.active-orders")} className={trackSpan(view, "xl:col-span-2")}>
                        <span className="tabular-nums">{organization.activeOrders}</span>
                        <span className="text-muted-foreground tabular-nums"> / {organization.totalOrders}</span>
                    </LabeledField>

                    {isCarrier ? (
                        <>
                            <LabeledField label={t("fields.on-time")} className={trackSpan(view, "xl:col-span-2")}>
                                {percent(organization.onTimeRate) ?? <EmptyValue label={t("values.none")} />}
                            </LabeledField>

                            <LabeledField label={t("fields.fleet-size")} className={trackSpan(view, "xl:col-span-2")}>
                                <span className="tabular-nums">{organization.fleetSize}</span>
                            </LabeledField>
                        </>
                    ) : (
                        <LabeledField label={t("fields.payment")} className={trackSpan(view, "xl:col-span-4")}>
                            {percent(organization.settledRate) ?? <EmptyValue label={t("values.none")} />}
                        </LabeledField>
                    )}
                </>
            }
        />
    )
}
