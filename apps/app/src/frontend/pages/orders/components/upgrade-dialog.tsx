"use client"

import { IconCheck, IconMail } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

const FEATURES = ["orders", "requests", "quotes"] as const

// Plans are set by Appload staff in Admin (plan §4), so the portal's side of
// a plan change is a conversation, not a checkout — same as the settings card
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

/**
 * What a free company gets instead of the action it just asked for. The
 * pro-gated buttons (new order, send to carriers, quote) open this rather
 * than the form: the procedure behind each of them would refuse with
 * SUBSCRIPTION_REQUIRED, and being told why beats being told no.
 */
export function UpgradeDialog({
    open,
    onOpenChange,
    organizationName,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    organizationName: string
}) {
    const t = useTranslations("App.orders.upgrade")

    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
        t("subject", { organization: organizationName }),
    )}`

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                <ul className="flex flex-col gap-2">
                    {FEATURES.map((feature) => (
                        <li key={feature} className="text-muted-foreground flex items-start gap-2 text-sm">
                            <IconCheck className="mt-0.5 size-4 shrink-0" stroke={1.5} />
                            {t(`features.${feature}`)}
                        </li>
                    ))}
                </ul>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t("close")}</Button>
                    <Button asChild>
                        <a href={mailto}>
                            <IconMail stroke={1.5} />
                            {t("contact")}
                        </a>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
