"use client"

import { IconAlertTriangle, IconArrowRight, IconSnowflake } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { money } from "@/frontend/pages/orders/lib/format"
import { Dash, DetailRow, SectionCard } from "@/frontend/pages/orders/components/section-card"
import type { OrderDetail } from "@/frontend/pages/orders/types"

/**
 * What the trip is: the two ends and the dates on the left, the load itself
 * on the right. Everything here is the order as filed — what has actually
 * happened to it is the rail above and the timeline below.
 */
export function RouteCargoCard({ order }: { order: OrderDetail }) {
    const t = useTranslations("App.orders.detail")
    const tv = useTranslations("App.orders")
    const f = useFormatter()

    const date = (value: Date | null) =>
        value ? f.dateTime(value, { dateStyle: "medium" }) : <Dash />

    return (
        <SectionCard title={t("sections.trip")}>
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs">{t("fields.route")}</span>
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            <span>{order.loadingAddress.address}</span>
                            <IconArrowRight className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
                            <span>{order.offloadingAddress.address}</span>
                        </div>
                    </div>

                    <dl className="flex flex-col gap-2">
                        <DetailRow label={t("fields.expectedLoading")}>{date(order.expectedLoadingDate)}</DetailRow>
                        <DetailRow label={t("fields.expectedOffloading")}>{date(order.expectedOffloadingDate)}</DetailRow>
                        <DetailRow label={t("fields.actualLoading")}>{date(order.actualLoadingDate)}</DetailRow>
                        <DetailRow label={t("fields.actualOffloading")}>{date(order.actualOffloadingDate)}</DetailRow>
                        <DetailRow label={t("fields.distance")}>
                            {order.distance !== null ? t("values.km", { km: f.number(order.distance) }) : <Dash />}
                        </DetailRow>
                        <DetailRow label={t("fields.routeType")}>
                            {tv(`routeType.${order.route}`)} · {tv(`tripType.${order.tripType}`)}
                        </DetailRow>
                    </dl>
                </div>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs">{t("fields.cargo")}</span>
                        <span className="text-sm font-medium">{tv(`category.${order.category}`)}</span>
                        <p className="text-muted-foreground text-sm">{order.description}</p>
                    </div>

                    <dl className="flex flex-col gap-2">
                        <DetailRow label={t("fields.weight")}>
                            {f.number(order.weight, { maximumFractionDigits: 1 })} {tv(`weightUnit.${order.weightUnit}`)}
                        </DetailRow>
                        <DetailRow label={t("fields.loadType")}>{tv(`loadType.${order.loadType}`)}</DetailRow>
                        <DetailRow label={t("fields.packing")}>
                            {order.packing ? tv(`packing.${order.packing}`) : <Dash />}
                        </DetailRow>
                        <DetailRow label={t("fields.deliveries")}>{order.deliveries ?? <Dash />}</DetailRow>
                        <DetailRow label={t("fields.trucks")}>{order.expectedTrucks ?? <Dash />}</DetailRow>
                    </dl>

                    {(order.isHazardous || order.isRefrigerated) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {order.isHazardous && (
                                <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
                                    <IconAlertTriangle className="size-3" />
                                    {order.hazchemCode
                                        ? t("values.hazardous-code", { code: order.hazchemCode })
                                        : t("values.hazardous")}
                                </Badge>
                            )}

                            {order.isRefrigerated && (
                                <Badge variant="outline" className="gap-1">
                                    <IconSnowflake className="size-3" />
                                    {order.temperature !== null
                                        ? t("values.refrigerated-at", { temperature: f.number(order.temperature) })
                                        : t("values.refrigerated")}
                                </Badge>
                            )}
                        </div>
                    )}

                    {order.isRefrigerated && order.temperatureInstructions && (
                        <p className="text-muted-foreground text-xs">{order.temperatureInstructions}</p>
                    )}
                </div>
            </div>
        </SectionCard>
    )
}

/**
 * The tenant's own leg of the deal, and only that: a client sees what it
 * pays, a carrier what it is paid. Neither is ever shown the other's figure,
 * and Appload's commission is not projected at all.
 */
export function MoneyCard({ order }: { order: OrderDetail }) {
    const t = useTranslations("App.orders.detail")
    const f = useFormatter()

    const amount = (value: number | null) => money(f, value, order.money.currency, 2) ?? <Dash />

    return (
        <SectionCard title={t("sections.money")} aside={order.money.currency}>
            <dl className="flex flex-col gap-2">
                <DetailRow label={t("fields.subtotal")}>{amount(order.money.subtotal)}</DetailRow>
                <DetailRow label={t("fields.vat")}>{amount(order.money.vat)}</DetailRow>
                <DetailRow label={<span className="font-medium">{t("fields.total")}</span>}>
                    <span className="font-medium">{amount(order.money.total)}</span>
                </DetailRow>
            </dl>

            <p className="text-muted-foreground text-xs">{t("money-hint")}</p>
        </SectionCard>
    )
}
