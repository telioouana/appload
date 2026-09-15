"use client"

import { IconArrowNarrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash } from "@workspace/ui/customs/list/table-cells"

import { MovementRouteMap } from "@/frontend/pages/movements/components/movement-route-map"
import type { MovementDetail } from "@/frontend/pages/movements/types"

/**
 * Where the load goes, when, and what it carries. The map is the lane Google
 * drew and, once the truck is moving, where it has been.
 *
 * The vocabularies shared with Appload's orders — the same database enums —
 * are read from App.orders rather than restated.
 */
export function RouteCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.detail")
    const tv = useTranslations("App.orders")
    const f = useFormatter()

    const date = (value: Date | null) => value ? f.dateTime(value, { dateStyle: "medium" }) : <Dash />

    return (
        <SectionCard title={t("route")} aside={tv(`routeType.${load.route}`)}>
            <div className="flex flex-col gap-1.5 text-sm">
                <span>{load.origin.address}</span>
                <span className="text-muted-foreground flex items-center gap-1.5">
                    <IconArrowNarrowRight className="size-4 shrink-0" stroke={1.5} />
                    {load.destination.address}
                </span>
            </div>

            <MovementRouteMap loadId={load.id} status={load.status} className="h-72 overflow-hidden rounded-xl" />

            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                <dl className="flex flex-col gap-2">
                    <DetailRow label={t("fields.loading")}>{date(load.expectedLoadingDate)}</DetailRow>
                    <DetailRow label={t("fields.due")}>{date(load.expectedDeliveryAt)}</DetailRow>
                    <DetailRow label={t("fields.started")}>{date(load.startedAt)}</DetailRow>
                    <DetailRow label={t("fields.delivered")}>{date(load.deliveredAt)}</DetailRow>
                </dl>

                <dl className="flex flex-col gap-2">
                    <DetailRow label={t("fields.category")}>
                        {load.category ? tv(`category.${load.category}`) : <Dash />}
                    </DetailRow>
                    <DetailRow label={t("fields.weight")}>
                        {load.weight !== null
                            ? `${f.number(load.weight, { maximumFractionDigits: 3 })} ${load.weightUnit ? tv(`weightUnit.${load.weightUnit}`) : ""}`
                            : <Dash />}
                    </DetailRow>
                    <DetailRow label={t("fields.cargo")}>
                        {load.cargoDescription
                            ? <span className="line-clamp-3 text-left whitespace-pre-line">{load.cargoDescription}</span>
                            : <Dash />}
                    </DetailRow>
                </dl>
            </div>

            {load.notes && (
                <p className="bg-muted/40 text-muted-foreground rounded-xl px-4 py-3 text-[13px] whitespace-pre-line">
                    {load.notes}
                </p>
            )}
        </SectionCard>
    )
}
