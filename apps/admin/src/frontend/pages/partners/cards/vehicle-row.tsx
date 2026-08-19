"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { EmptyValue, LabeledField } from "@/components/list/labeled-field"
import { useKycReview } from "@/frontend/pages/kyc/hooks/use-kyc-review"
import { PartnerRow, trackSpan } from "@/frontend/pages/partners/cards/partner-row"
import { TripLocation } from "@/frontend/pages/partners/sections/trip-location"
import type { VehicleRow as VehicleRowValues, VIEW } from "@/frontend/pages/partners/types"
import {
    DocProgressChip,
    ExpiryHint,
    KycBadge,
    OwnershipBadge,
} from "@/frontend/pages/partners/sections/badges"

export function VehicleRow({
    vehicle,
    view,
    today,
}: {
    vehicle: VehicleRowValues
    view: VIEW
    today: string
}) {
    const t = useTranslations("Admin.partners")
    // Cargo categories are already translated for the order filters; reuse
    // those rather than duplicating eleven labels under a second namespace
    const categories = useTranslations("Admin.orders.header.filters.category")
    const f = useFormatter()
    const { onOpen } = useKycReview()

    return (
        <PartnerRow
            view={view}
            name={vehicle.regPlate}
            // Plates are masked "AAA 000 MC"; the letter block identifies it
            fallback={vehicle.regPlate.slice(0, 3)}
            meta={`${vehicle.brand} ${vehicle.model} · ${vehicle.year}`}
            badges={
                <>
                    <KycBadge status={vehicle.kycStatus} />
                    <OwnershipBadge status={vehicle.ownershipStatus} />
                </>
            }
            onReview={() => onOpen({
                subjectType: vehicle.kind,
                subjectId: vehicle.id,
                title: vehicle.regPlate,
                subtitle: vehicle.carrierName ?? undefined,
            })}
            fields={
                <>
                    <LabeledField label={t("fields.carrier")} className={trackSpan(view, "xl:col-span-3")}>
                        {vehicle.carrierName ?? <EmptyValue label={t("values.none")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.location")} className={trackSpan(view, "xl:col-span-2")}>
                        <TripLocation trip={vehicle.trip} variant="route" />
                    </LabeledField>

                    <LabeledField label={t("fields.load")} className={trackSpan(view, "xl:col-span-2")}>
                        {vehicle.trip?.load
                            ? categories(`options.${vehicle.trip.load}` as never)
                            : <EmptyValue label={t("values.empty")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.driver")} className={trackSpan(view, "xl:col-span-2")}>
                        {vehicle.driverName ?? <EmptyValue label={t("values.unassigned")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.capacity")} className={trackSpan(view, "xl:col-span-1")}>
                        {vehicle.capacity !== null
                            ? t("values.tons", { tons: f.number(vehicle.capacity) })
                            : <EmptyValue label={t("values.none")} />}
                    </LabeledField>

                    <LabeledField label={t("fields.documents")} className={trackSpan(view, "xl:col-span-2")}>
                        <div className="flex flex-col gap-0.5">
                            <DocProgressChip progress={vehicle.progress} />
                            <ExpiryHint date={vehicle.nextExpiry} today={today} />
                        </div>
                    </LabeledField>
                </>
            }
        />
    )
}
