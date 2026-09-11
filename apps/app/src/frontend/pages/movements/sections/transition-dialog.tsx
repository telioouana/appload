"use client"

import { useState } from "react"

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
import { useStatusLabel } from "@/frontend/pages/movements/components/badges"
import type { MovementDetail, TransitionOption } from "@/frontend/pages/movements/types"

/** Mirrors TEXT_MAX on the transition schema. */
const NOTE_MAX = 500

/**
 * Taking one move. Every move is confirmed — a load that left cannot un-leave
 * — and calling one off after it was scheduled asks for the reason, which
 * goes on the trail every company on the load reads.
 */
export function TransitionDialog({
    load,
    option,
    onClose,
    onPlanRefused,
}: {
    load: MovementDetail
    option: TransitionOption
    onClose: () => void
    onPlanRefused: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.loads")
    const statusLabel = useStatusLabel()

    const { transition } = useMovementMutations()

    const [note, setNote] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const cancelling = option.to === "cancelled"
    // The moves that set something off beyond the status: the plan and the
    // driver's messages, the chain below, the books
    const consequence = option.to === "in-transit" || option.to === "cancelled" || option.to === "closed" ? option.to : null
    const missingNote = option.needsNote && note.trim().length === 0

    function submit() {
        setError(null)

        transition.mutate(
            { id: load.id, expectedVersion: load.version, to: option.to, note: note.trim() || undefined },
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
        <Dialog open onOpenChange={(next) => { if (!next && !transition.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(`actions.to.${option.to}`)}</DialogTitle>
                    <DialogDescription>
                        {t("transition.description", {
                            ref: load.ref,
                            from: statusLabel(load.status, load.execution),
                            to: statusLabel(option.to, load.execution),
                        })}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {consequence && (
                        <p className="text-muted-foreground text-sm">
                            {t(`transition.consequence.${consequence}`)}
                        </p>
                    )}

                    {(cancelling || option.needsNote) && (
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="transition-note">
                                {option.needsNote ? t("transition.note-required") : t("transition.note")}
                            </Label>
                            <Textarea
                                id="transition-note"
                                value={note}
                                maxLength={NOTE_MAX}
                                disabled={transition.isPending}
                                placeholder={t("transition.note-placeholder")}
                                onChange={(event) => setNote(event.target.value)}
                            />
                        </div>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={transition.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button
                        variant={cancelling ? "destructive" : "default"}
                        disabled={transition.isPending || missingNote}
                        onClick={submit}
                    >
                        {transition.isPending && <Spinner className="size-4" />}
                        {t("dialogs.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
