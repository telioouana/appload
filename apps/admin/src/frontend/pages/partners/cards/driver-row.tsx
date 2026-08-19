"use client"

import { useTranslations } from "@workspace/i18n"

import { EmptyValue, LabeledField } from "@/components/list/labeled-field"
import { useKycReview } from "@/frontend/pages/kyc/hooks/use-kyc-review"
import { initials, PartnerRow, trackSpan } from "@/frontend/pages/partners/cards/partner-row"
import { TripLocation } from "@/frontend/pages/partners/sections/trip-location"
import type { DriverRow as DriverRowValues, VIEW } from "@/frontend/pages/partners/types"
import { DocProgressChip, ExpiryHint, KycBadge } from "@/frontend/pages/partners/sections/badges"

export function DriverRow({
    driver,
    view,
    today,
}: {
    driver: DriverRowValues
    view: VIEW
    today: string
}) {
    const t = useTranslations("Admin.partners")
    const { onOpen } = useKycReview()

    return (
        <PartnerRow
            view={view}
            name={driver.name}
            image={driver.image}
            fallback={initials(driver.name)}
            meta={driver.email}
            badges={<KycBadge status={driver.kycStatus} />}
            onReview={() => onOpen({
                subjectType: "driver",
                subjectId: driver.id,
                title: driver.name,
                subtitle: driver.carrierName ?? undefined,
            })}
            fields={
                <>
                    <LabeledField label={t("fields.phone")} className={trackSpan(view, "xl:col-span-2")}>
                        {driver.phoneNumber
                            ? <span className="tabular-nums">{driver.phoneNumber}</span>
                            : <EmptyValue label={t("values.none")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.carrier")} className={trackSpan(view, "xl:col-span-3")}>
                        {driver.carrierName ?? <EmptyValue label={t("values.none")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.location")} className={trackSpan(view, "xl:col-span-3")}>
                        <TripLocation trip={driver.trip} />
                    </LabeledField>

                    <LabeledField label={t("fields.truck")} className={trackSpan(view, "xl:col-span-2")}>
                        {driver.plate
                            ? <span className="tabular-nums">{driver.plate}</span>
                            : <EmptyValue label={t("values.unassigned")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.documents")} className={trackSpan(view, "xl:col-span-2")}>
                        <div className="flex flex-col gap-0.5">
                            <DocProgressChip progress={driver.progress} />
                            <ExpiryHint date={driver.nextExpiry} today={today} />
                        </div>
                    </LabeledField>
                </>
            }
        />
    )
}
