"use client"

import { IconRocket } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { Link } from "@/i18n/navigation"

/**
 * What a free plan gets instead of the form. Writing a standing quote is a
 * paid action (`proProcedure`), so the button stays where it is and says why
 * it cannot be used rather than disappearing — a disabled control the reader
 * cannot explain is worse than an honest one.
 */
export function UpgradeCard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations("App.quotes.upgrade")

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <IconRocket className="size-5" stroke={1.5} />
                        {t("title")}
                    </DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                <DialogFooter>
                    <Button asChild onClick={() => onOpenChange(false)}>
                        <Link href="/settings">{t("action")}</Link>
                    </Button>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t("dismiss")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
