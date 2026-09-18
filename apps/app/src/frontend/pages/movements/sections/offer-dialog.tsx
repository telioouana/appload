"use client"

import { useState } from "react"

import { isApploadOrg } from "@workspace/db/types"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { planRefusal, type PlanReason } from "@/components/plan-dialog"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import type { MovementDetail } from "@/frontend/pages/movements/types"

const MESSAGE_MAX = 500

/**
 * Placing the load with a partner on the portal. The partner sees the terms
 * exactly as they stand — the lane, the cargo, the dates and what it will be
 * paid — and they freeze on both sides while it decides; nothing about the
 * owner's own client or margin goes with them.
 *
 * Appload is one of those partners, with one difference: sending it the load
 * opens an Appload order, which it takes to the market. That asks for a
 * loading date, a category, the cargo and its weight, and says so when one
 * of them is missing.
 */
export function OfferDialog({
    load,
    onClose,
    onPlanRefused,
}: {
    load: MovementDetail
    onClose: () => void
    onPlanRefused: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.loads")
    const money = useMoney()

    const { offer } = useMovementMutations()

    const [message, setMessage] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const price = load.money.payable
    const toAppload = isApploadOrg(load.carrier?.id)

    function submit() {
        setError(null)

        offer.mutate(
            { id: load.id, expectedVersion: load.version, message: message.trim() || undefined },
            {
                onSuccess: onClose,
                onError: (failure) => {
                    const reason = planRefusal(failure)

                    if (reason) {
                        onClose()
                        onPlanRefused(reason)
                        return
                    }

                    setError(movementErrorKey(failure))
                },
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !offer.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{toAppload ? t("appload.sendToAppload") : t("offer.title")}</DialogTitle>
                    <DialogDescription>
                        {toAppload
                            ? t("appload.sendDescription")
                            : t("offer.description", { partner: load.carrier?.name ?? "" })}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {price && (
                        <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm">
                            <span className="text-muted-foreground">{t("offer.price")}</span>
                            <span className="font-medium tabular-nums">{money(price.total, price.currency)}</span>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="offer-message">{t("offer.message")}</Label>
                        <Textarea
                            id="offer-message"
                            value={message}
                            maxLength={MESSAGE_MAX}
                            disabled={offer.isPending}
                            placeholder={t("offer.message-placeholder")}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={offer.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button disabled={offer.isPending} onClick={submit}>
                        {offer.isPending && <Spinner className="size-4" />}
                        {toAppload ? t("appload.sendToAppload") : t("offer.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
