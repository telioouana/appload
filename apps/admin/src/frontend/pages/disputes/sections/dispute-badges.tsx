"use client"

import { useTranslations } from "@workspace/i18n"
import type { DisputeReason, DisputeStatus } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"

import { cn } from "@workspace/ui/lib/utils"

const STATUS_STYLES: Record<DisputeStatus, string> = {
    "open": "bg-red-500/15 text-red-600 dark:text-red-400",
    "under-review": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    "settled": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    "closed": "bg-muted text-muted-foreground",
}

export function DisputeStatusBadge({ status, className }: { status: DisputeStatus; className?: string }) {
    const t = useTranslations("Admin.disputes.values.statuses")

    return (
        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_STYLES[status], className)}>
            {t(status)}
        </span>
    )
}

export function DisputeReasonBadge({ reason }: { reason: DisputeReason }) {
    const t = useTranslations("Admin.disputes.values.reasons")

    return <Badge variant="outline">{t(reason)}</Badge>
}

/** Which side's money the dispute holds, as two small chips. */
export function HoldChips({ shipper, carrier }: { shipper: boolean; carrier: boolean }) {
    const t = useTranslations("Admin.disputes.values")

    if (!shipper && !carrier) return <span className="text-muted-foreground text-xs">{t("no-holds")}</span>

    return (
        <span className="flex flex-wrap gap-1">
            {shipper && <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400">{t("hold-shipper")}</Badge>}
            {carrier && <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400">{t("hold-carrier")}</Badge>}
        </span>
    )
}
