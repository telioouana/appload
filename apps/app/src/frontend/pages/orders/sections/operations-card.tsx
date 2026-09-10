"use client"

import { useTranslations } from "@workspace/i18n"

import { PlateChip } from "@/components/list/table-cells"
import { Dash, DetailRow, SectionCard } from "@/frontend/pages/orders/components/section-card"
import type { OrderDetail } from "@/frontend/pages/orders/types"

/**
 * Who is driving and in what. A booked order legitimately has none of this
 * yet — naming the rig is what dispatch does — so the card says so rather
 * than showing an empty grid. The driver's document number is the carrier's
 * own record and never travels to the client.
 */
export function OperationsCard({ order }: { order: OrderDetail }) {
    const t = useTranslations("App.orders.detail")
    const tv = useTranslations("App.orders")

    const dispatch = order.dispatch

    return (
        <SectionCard title={t("sections.operations")}>
            {!dispatch || (!dispatch.driverName && !dispatch.truckPlate) ? (
                <p className="text-muted-foreground py-2 text-sm">{t("operations-empty")}</p>
            ) : (
                <dl className="flex flex-col gap-2">
                    <DetailRow label={t("fields.driver")}>
                        {dispatch.driverName ?? <Dash />}
                    </DetailRow>

                    <DetailRow label={t("fields.driverPhone")}>
                        {dispatch.driverPhoneNumber ?? <Dash />}
                    </DetailRow>

                    {dispatch.driverPassport && (
                        <DetailRow label={t("fields.driverPassport")}>{dispatch.driverPassport}</DetailRow>
                    )}

                    <DetailRow label={t("fields.truck")}>
                        {dispatch.truckPlate ? <PlateChip plate={dispatch.truckPlate} /> : <Dash />}
                    </DetailRow>

                    <DetailRow label={t("fields.trailer")}>
                        {dispatch.trailerPlate ? <PlateChip plate={dispatch.trailerPlate} /> : <Dash />}
                    </DetailRow>

                    <DetailRow label={t("fields.link")}>
                        {dispatch.linkPlate ? <PlateChip plate={dispatch.linkPlate} /> : <Dash />}
                    </DetailRow>

                    <DetailRow label={t("fields.truckAge")}>
                        {dispatch.truckAge ? tv(`truckAge.${dispatch.truckAge}`) : <Dash />}
                    </DetailRow>

                    <DetailRow label={t("fields.pod")}>
                        {order.podStatus ? tv(`podStatus.${order.podStatus}`) : <Dash />}
                    </DetailRow>
                </dl>
            )}
        </SectionCard>
    )
}
