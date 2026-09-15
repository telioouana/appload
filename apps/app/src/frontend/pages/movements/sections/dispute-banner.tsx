"use client"

import { useState } from "react"
import { IconGavel } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { cn } from "@workspace/ui/lib/utils"

import { ResolveDisputeDialog } from "@/frontend/pages/movements/sections/resolve-dispute-dialog"
import type { MovementDisputeView } from "@/frontend/pages/movements/types"

/**
 * The dispute on a load, above everything else on its page: why, who opened
 * it and when, and what they wrote, word for word. The opener is named only
 * where the server says the reader may know that company; anybody else is
 * "a company on this load", since a client must never learn who its
 * transporter handed the load to, nor an executor who the load is for.
 *
 * An open dispute is loud, with the Resolve button for the company that
 * opened it; a resolved one stays on the page quietly, with how it ended.
 */
export function DisputeBanner({ dispute }: { dispute: MovementDisputeView }) {
    const t = useTranslations("App.loads.disputes")
    const f = useFormatter()

    const [resolving, setResolving] = useState(false)

    const open = dispute.status === "open"
    const values = {
        reason: t(`reasons.${dispute.reason}`),
        date: f.dateTime(dispute.openedAt, { dateStyle: "medium" }),
    }

    return (
        <>
            <Alert variant={open ? "destructive" : "default"} className={cn("mx-2 w-auto shrink-0", !open && "bg-muted/40")}>
                <IconGavel stroke={1.5} />
                <AlertTitle>{t(open ? "banner.open" : "banner.resolved")}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1.5">
                    <span className="font-medium">
                        {dispute.openedBy.name
                            ? t("banner.opened", { ...values, name: dispute.openedBy.name })
                            : t("banner.opened-unnamed", values)}
                    </span>
                    <p className="whitespace-pre-line">{dispute.description}</p>
                    {!open && dispute.resolution && (
                        <p className="whitespace-pre-line">
                            {dispute.resolvedAt
                                ? t("banner.resolution", { date: f.dateTime(dispute.resolvedAt, { dateStyle: "medium" }), resolution: dispute.resolution })
                                : dispute.resolution}
                        </p>
                    )}
                </AlertDescription>
                {open && dispute.canResolve && (
                    <AlertAction>
                        <Button size="sm" variant="outline" onClick={() => setResolving(true)}>
                            {t("banner.resolve")}
                        </Button>
                    </AlertAction>
                )}
            </Alert>

            {resolving && <ResolveDisputeDialog dispute={dispute} onClose={() => setResolving(false)} />}
        </>
    )
}
