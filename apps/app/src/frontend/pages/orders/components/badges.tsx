"use client"

import { IconCheck, IconMapPin, IconShieldCheck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"

import type { OfferStatus, OrderRequestStatus, OrderStatus } from "@/frontend/pages/orders/types"

/** Where the order is on its chain — the same badge Appload's own staff see. */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
    const t = useTranslations("App.orders.status")

    return <StatusBadge label={t(status)} status={status} className={className} />
}

/** What became of one quote. */
export function OfferStatusBadge({ status }: { status: OfferStatus }) {
    const t = useTranslations("App.orders.offerStatus")

    return (
        <Badge
            variant="outline"
            className={cn(
                "gap-1",
                status === "accepted" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : status === "pending" ? "border-primary/40 text-primary"
                        : "text-muted-foreground",
            )}
        >
            {status === "accepted" && <IconCheck className="size-3" />}
            {t(status)}
        </Badge>
    )
}

/** Where one carrier's request round stands. */
export function RequestStatusChip({ status }: { status: OrderRequestStatus }) {
    const t = useTranslations("App.orders.requestStatus")

    return (
        <Badge
            variant="outline"
            className={cn(
                "rounded-full font-normal",
                status === "quoted" ? "border-primary/40 text-primary"
                    : status === "requested" ? undefined
                        : "text-muted-foreground",
            )}
        >
            {t(status)}
        </Badge>
    )
}

/** What the quote covers — an excluded cover is stated, not left out. */
export function IncludesChips({ git, gps }: { git: boolean; gps: boolean }) {
    const t = useTranslations("App.orders.offers.includes")

    return (
        <span className="flex items-center gap-1">
            <IncludeChip included={git} label={t("git")} icon={<IconShieldCheck className="size-3" />} />
            <IncludeChip included={gps} label={t("gps")} icon={<IconMapPin className="size-3" />} />
        </span>
    )
}

function IncludeChip({ included, label, icon }: { included: boolean; label: string; icon: React.ReactNode }) {
    return (
        <Badge variant="outline" className={cn("gap-1", !included && "text-muted-foreground/60 line-through")}>
            {icon}
            {label}
        </Badge>
    )
}
