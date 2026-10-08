"use client"

import { IconMail, IconRosetteDiscountCheck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { domainErrorCode } from "@workspace/trpc/errors"

// Plans are agreed commercially and recorded by staff in Admin, so the
// portal's side of one is a conversation, not a checkout
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

/** The one refusal a plan can produce, plus the sentinel for everything else. */
const PLAN_REFUSALS = ["SUBSCRIPTION_REQUIRED", "OTHER"] as const

export type PlanReason = Exclude<(typeof PLAN_REFUSALS)[number], "OTHER">

/** Which copy each refusal reads under; the codes themselves are not message keys. */
const COPY: Record<PlanReason, "no-plan"> = {
    SUBSCRIPTION_REQUIRED: "no-plan",
}

/**
 * The plan reason a mutation was refused for, or null when it failed for
 * anything else — the code is answered by this dialog rather than by a
 * message that only says no.
 */
export function planRefusal(error: unknown): PlanReason | null {
    const code = domainErrorCode(error, PLAN_REFUSALS, "OTHER")

    return code === "OTHER" ? null : code
}

/**
 * Why an allowance cannot start another movement, or null when it can — what
 * the buttons that book, accept and dispatch consult before opening their
 * form, so the refusal arrives before the work rather than after it. A spent
 * allowance is not a refusal: the movement goes through as an extra.
 */
export function planBlock(allowance: TrackingAllowance | null): PlanReason | null {
    if (allowance === null) return null

    return allowance.active ? null : "SUBSCRIPTION_REQUIRED"
}

/**
 * What a company gets instead of the booking, the acceptance or the dispatch
 * it just asked for: that it has no active plan, what it has already used
 * this month, and the two ways out — the subscription screen and Appload
 * itself.
 */
export function PlanDialog({
    reason,
    organizationName,
    onClose,
}: {
    reason: PlanReason
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
