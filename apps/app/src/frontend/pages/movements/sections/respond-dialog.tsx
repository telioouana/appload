"use client"

import { useState } from "react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useRouter } from "@/i18n/navigation"
import { planRefusal, type PlanReason } from "@/components/plan-dialog"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import type { MovementDetail } from "@/frontend/pages/movements/types"

const NOTE_MAX = 500

/**
 * A partner's answer to the load it was offered. A yes makes the load this
 * company's own trip — its own row, with the partner as its client and the
 * agreed price as what it charges — and that is where the page goes next:
 * the driver, the truck and the tracking are named there. A no goes back
 * with the reason, if one is given.
 */
export function RespondDialog({
    load,
    decision,
    onClose,
    onPlanRefused,
}: {
    load: MovementDetail
    decision: "accept" | "decline"
    onClose: () => void
    onPlanRefused: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.loads")
    const money = useMoney()
    const router = useRouter()

    const { respond } = useMovementMutations()

    const [note, setNote] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const accepting = decision === "accept"
    const price = load.money.receivable

    function submit() {
        setError(null)

        respond.mutate(
            { id: load.id, expectedVersion: load.version, decision, note: note.trim() || undefined },
            {
                onSuccess: (result) => {
                    onClose()
                    if (accepting) router.push({ pathname: "/orders/load/[loadId]", params: { loadId: result.id } })
                },
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
        <Dialog open onOpenChange={(next) => { if (!next && !respond.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(accepting ? "respond.accept-title" : "respond.decline-title")}</DialogTitle>
                    <DialogDescription>
                        {t(accepting ? "respond.accept-description" : "respond.decline-description", {
                            ref: load.ref,
                            owner: load.owner?.name ?? "",
                        })}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {price && (
                        <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm">
                            <span className="text-muted-foreground">{t("respond.price")}</span>
                            <span className="font-medium tabular-nums">{money(price.total, price.currency)}</span>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="respond-note">{t("respond.note")}</Label>
                        <Textarea
                            id="respond-note"
                            value={note}
                            maxLength={NOTE_MAX}
                            disabled={respond.isPending}
                            placeholder={t(accepting ? "respond.accept-placeholder" : "respond.decline-placeholder")}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={respond.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button variant={accepting ? "default" : "destructive"} disabled={respond.isPending} onClick={submit}>
                        {respond.isPending && <Spinner className="size-4" />}
                        {t(accepting ? "actions.accept" : "actions.decline")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
