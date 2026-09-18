"use client"

import { IconBox, IconFlagCheck, IconMapPin, IconRoute, IconTruck, IconWeight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { Badge } from "@workspace/ui/components/badge"

import { CargoFlags } from "@/frontend/pages/orders/sections/order-item-shared"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"

/**
 * Where the load goes and what it is. The full addresses, not the city-level
 * summary the page used to show, each under the date its leg is due — and
 * the description as its own paragraph rather than a fragment of the title.
 */
export function RouteCard({ order }: { order: Order }) {
    const t = useTranslations("Admin.orders.detailPage")
    const tSheet = useTranslations("Admin.orders.list.sheet")
    const tValues = useTranslations("Admin.orders.list.values")
    const tCategory = useTranslations("Admin.orders.header.filters.category.options")
    const f = useFormatter()

    const day = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })
    const weight = (value: string | null) =>
        value === null ? null : `${f.number(Number(value), { maximumFractionDigits: 1 })} ${order.weightUnit}`

    const loaded = weight(order.loadedWeight)
    const booked = weight(order.weight)

    return (
        <SectionCard
            title={t("sections.route")}
            aside={
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="gap-1">
                        <IconRoute className="size-3" />
                        {tValues(order.route === "regional" ? "regional" : "national")}
                    </Badge>

                    {order.tripType === "backload" && (
                        <Badge variant="outline">{tValues("backload")}</Badge>
                    )}

                    <Badge variant="outline" className="gap-1">
                        <IconTruck className="size-3" />
                        {tSheet("trucks", { count: order.expectedTrucks ?? 1 })}
                        {" · "}
                        {tSheet("deliveries", { count: order.deliveries ?? 1 })}
                    </Badge>
                </div>
            }
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <ol className="relative flex min-w-0 flex-1 flex-col gap-3.5 before:absolute before:top-8 before:bottom-8 before:left-[13px] before:border-l before:border-dashed before:border-border">
                    <Stop
                        icon={<IconMapPin className="size-3.5 text-destructive" />}
                        address={order.loadingAddress.address}
                        place={order.loadingAddress.state || order.loadingAddress.country}
                        note={order.actualLoadingDate
                            ? tSheet("loaded", { date: day(order.actualLoadingDate) })
                            : order.expectedLoadingDate
                                ? tSheet("expected", { date: day(order.expectedLoadingDate) })
                                : null}
                    />
                    <Stop
                        icon={<IconFlagCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
                        address={order.offloadingAddress.address}
                        place={order.offloadingAddress.state || order.offloadingAddress.country}
                        note={order.actualOffloadingDate
                            ? tSheet("offloaded", { date: day(order.actualOffloadingDate) })
                            : order.expectedOffloadingDate
                                ? tSheet("expected", { date: day(order.expectedOffloadingDate) })
                                : null}
                    />
                </ol>

                {order.distance !== null && (
                    <div className="flex shrink-0 flex-col items-end">
                        <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                            {f.number(order.distance)} km
                        </span>
                        <span className="text-muted-foreground text-xs">{t("metrics.distance")}</span>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t pt-3 text-[13px]">
                <IconBox className="text-muted-foreground size-3.5" />
                <span className="font-medium">{tCategory(order.category)}</span>

                <span className="text-muted-foreground">·</span>
                <IconWeight className="text-muted-foreground size-3.5" />
                <span className="tabular-nums">
                    {booked} {t("route.weightBooked")}
                    {loaded && (
                        <>
                            <span className="text-muted-foreground"> · </span>
                            {loaded} {t("route.weightLoaded")}
                        </>
                    )}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                    <CargoFlags order={order} />
                </div>
            </div>

            {order.description && (
                <div className="flex flex-col gap-0.5 border-t pt-3">
                    <span className="text-muted-foreground text-xs">{t("sections.description")}</span>
                    <p className="text-[13px] text-pretty">{order.description}</p>
                </div>
            )}
        </SectionCard>
    )
}

function Stop({
    icon,
    address,
    place,
    note,
}: {
    icon: React.ReactNode
    address: string
    place: string
    note: string | null
}) {
    return (
        <li className="flex items-start gap-2.5">
            <span className="bg-muted relative z-1 flex size-7 shrink-0 items-center justify-center rounded-full">
                {icon}
            </span>

            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] leading-tight font-medium">{address}</span>
                <span className="text-muted-foreground text-xs">
                    {place}
                    {note && ` · ${note}`}
                </span>
            </div>
        </li>
    )
}
