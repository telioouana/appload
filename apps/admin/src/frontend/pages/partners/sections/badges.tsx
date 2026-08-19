"use client"

import { IconAlertTriangle, IconContract, IconFileOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { KycStatus, OwnershipStatus, RiskLevel } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"

import { cn } from "@workspace/ui/lib/utils"
import type { ContractState, DocProgress } from "@/frontend/pages/partners/types"

export function KycBadge({ status }: { status: KycStatus }) {
    const t = useTranslations("Admin.partners.status")

    return <StatusBadge label={t(status)} status={status} />
}

/** Rendered only when there is something to say — "no risk" is not news. */
export function RiskBadge({ level, reason }: { level: RiskLevel; reason?: string | null }) {
    const t = useTranslations("Admin.partners.risk")

    if (level === "none") return null

    return (
        <span title={reason ?? undefined}>
            <StatusBadge label={t(level)} status={level === "high" ? "risk-high" : "risk-watch"} />
        </span>
    )
}

export function OwnershipBadge({ status }: { status: OwnershipStatus }) {
    const t = useTranslations("Admin.partners.ownership")

    return <StatusBadge label={t(status)} status={status} />
}

/**
 * A carrier's contract gets its own chip rather than folding into the
 * verification badge: it alone decides whether the carrier may operate, so
 * a missing one has to be visible without opening the row.
 */
export function ContractChip({ state }: { state: ContractState }) {
    const t = useTranslations("Admin.partners")

    if (state === "valid") {
        return (
            <Badge variant="outline" className="gap-1.5 rounded-full border-none bg-[var(--status-verified-bg)] text-[var(--status-verified-text)]">
                <IconContract size={14} />
                {t("fields.contract")}
            </Badge>
        )
    }

    return (
        <Badge variant="outline" className="gap-1.5 rounded-full border-none bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)]">
            <IconFileOff size={14} />
            {t(state === "expired" ? "review.contract-expired" : "review.contract-missing")}
        </Badge>
    )
}

/** How many required slots are approved — "5/8" at a glance. */
export function DocProgressChip({ progress }: { progress: DocProgress }) {
    const t = useTranslations("Admin.partners.values")
    const complete = progress.approved === progress.required

    return (
        <span className={cn(
            "text-sm tabular-nums",
            complete ? "text-[var(--status-verified-text)]" : "text-muted-foreground",
        )}>
            {t("progress", progress)}
        </span>
    )
}

/**
 * The soonest expiry among a subject's valid documents. Silent when nothing
 * expires within the month — a date far out is noise on a list row.
 */
export function ExpiryHint({ date, today }: { date: string | null; today: string }) {
    const t = useTranslations("Admin.partners.values")

    if (!date) return null

    const days = Math.round(
        (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
    )

    if (days > 30) return null

    return (
        <span className={cn(
            "inline-flex items-center gap-1 text-xs",
            days < 0 ? "text-[var(--status-rejected-text)]" : "text-[var(--status-expired-text)]",
        )}>
            <IconAlertTriangle size={12} />
            {days < 0 ? t("expired") : t("expires-in", { days })}
        </span>
    )
}
