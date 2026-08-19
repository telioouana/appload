"use client"

import { IconAlertTriangle, IconSnowflake } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { StatusBadge, type StatusKey } from "@workspace/ui/customs/badge/status-badge";

import { cn } from "@workspace/ui/lib/utils";

import type { OrderValues } from "@/frontend/pages/orders/types";

export function OrderStatusBadge({ status }: { status: OrderValues["status"] }) {
    const t = useTranslations("Admin.orders.header.filters.status.options");

    return (
        <StatusBadge
            label={t(status)}
            status={status as StatusKey}
        />
    )
}

const PAYMENT_STATUS_STYLES: Record<NonNullable<OrderValues["shipperPaymentStatus"]>, string> = {
    "pending": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    "partially": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    "completed": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    "not-applicable": "bg-muted text-muted-foreground",
};

/**
 * The status reads from Appload's side: the shipper leg is money received,
 * the carrier leg money paid — same status values, party-specific words.
 */
export function PaymentStatusChip({ party, status }: {
    party: "shipper" | "carrier"
    status: OrderValues["shipperPaymentStatus"]
}) {
    const t = useTranslations("Admin.orders.data.paymentStatus");

    return (
        <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
            status ? PAYMENT_STATUS_STYLES[status] : "bg-muted text-muted-foreground"
        )}>
            {t(`${party}.${status ?? "none"}`)}
        </span>
    )
}

export function CargoFlags({ order }: { order: OrderValues }) {
    const t = useTranslations("Admin.orders.data.flags");

    if (!order.isRefrigerated && !order.isHazardous) return null;

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {order.isRefrigerated && (
                <Badge variant="outline" className="gap-1 border-sky-500/30 text-sky-600 dark:text-sky-400">
                    <IconSnowflake className="size-3" />
                    {t("refrigerated")}
                </Badge>
            )}
            {order.isHazardous && (
                <Badge variant="outline" className="gap-1 border-orange-500/30 text-orange-600 dark:text-orange-400">
                    <IconAlertTriangle className="size-3" />
                    {t("hazardous")}
                </Badge>
            )}
        </div>
    )
}

// The Figma cards show city-level names; addresses in the DB are full
// place strings, so prefer the structured state and fall back to the
// first comma-segment of the address
export const place = (location: OrderValues["loadingAddress"]) =>
    location.state || location.address.split(",")[0]?.trim() || location.address;
