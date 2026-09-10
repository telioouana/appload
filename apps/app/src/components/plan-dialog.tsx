"use client"

import { IconMail, IconRosetteDiscountCheck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { domainErrorCode } from "@/lib/trpc-error"
import { PlanUsage } from "@/components/plan-usage"

// Plans are agreed commercially and recorded by staff in Admin, so the
// portal's side of one is a conversation, not a checkout
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

/** The two refusals a plan can produce, plus the sentinel for everything else. */
const PLAN_REFUSALS = ["SUBSCRIPTION_REQUIRED", "QUOTA_EXCEEDED", "OTHER"] as const

export type PlanReason = Exclude<(typeof PLAN_REFUSALS)[number], "OTHER">

/** Which copy each refusal reads under; the codes themselves are not message keys. */
const COPY: Record<PlanReason, "no-plan" | "quota"> = {
    SUBSCRIPTION_REQUIRED: "no-plan",
    QUOTA_EXCEEDED: "quota",
}

/**
 * The plan reason a mutation was refused for, or null when it failed for
 * anything else — the two codes are answered by this dialog rather than by a
 * message that only says no.
 */
export function planRefusal(error: unknown): PlanReason | null {
    const code = domainErrorCode(error, PLAN_REFUSALS, "OTHER")

    return code === "OTHER" ? null : code
}

/**
 * Why an allowance cannot start another movement, or null when it can — what
 * the buttons that book, accept and dispatch consult before opening their
 * form, so the refusal arrives before the work rather than after it.
 */
export function planBlock(allowance: TrackingAllowance | null): PlanReason | null {
    if (allowance === null) return null
    if (!allowance.active) return "SUBSCRIPTION_REQUIRED"

    return allowance.remaining === 0 ? "QUOTA_EXCEEDED" : null
}

/**
 * What a company gets instead of the booking, the acceptance or the dispatch
 * it just asked for: which of the two limits it hit, what it has already
 * used this month, and the two ways out — the subscription screen and
 * Appload itself.
 */
export function PlanDialog({
    reason,
    allowance,
    organizationName,
    onClose,
}: {
    reason: PlanReason
    allowance: TrackingAllowance | null
    organizationName: string
    onClose: () => void
}) {
    const t = useTranslations("App.plan")

    const copy = COPY[reason]

    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
        t("dialog.subject", { organization: organizationName }),
    )}`

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <IconRosetteDiscountCheck className="size-5" stroke={1.5} />
                        {t(`dialog.${copy}.title`)}
                    </DialogTitle>
                    <DialogDescription>{t(`dialog.${copy}.description`)}</DialogDescription>
                </DialogHeader>

                {allowance?.active && <PlanUsage allowance={allowance} />}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>{t("dialog.close")}</Button>

                    <Button asChild variant="outline" onClick={onClose}>
                        <Link href="/settings">{t("dialog.settings")}</Link>
                    </Button>

                    <Button asChild>
                        <a href={mailto}>
                            <IconMail stroke={1.5} />
                            {t("dialog.contact")}
                        </a>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
