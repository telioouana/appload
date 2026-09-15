"use client"

import { useState } from "react"
import { IconAlertTriangle } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { planRefusal, type PlanReason } from "@/components/plan-dialog"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { useFlagLabel, useMoveLabel, useStatusLabel } from "@/frontend/pages/movements/components/badges"
import type { MovementDetail, TransitionOption } from "@/frontend/pages/movements/types"

/** Mirrors TEXT_MAX on the transition schema. */
const NOTE_MAX = 500

/**
 * Taking one move. Every move is confirmed — a truck that loaded cannot
 * un-load — and the moves the server marks as needing a reason ask for it:
 * calling a load off after it was scheduled, saying a truck is stopped or
 * has an issue, or which of the two it now is. The reason goes on the trail
 * every company on the load reads.
 *
 * A move with something still missing is never refused, only flagged: the
 * dialog names what is missing, offers a line to say why it goes ahead
 * anyway, and the move itself records the flags it was taken with.
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
    const moveLabel = useMoveLabel()
    const flagLabel = useFlagLabel()

    const { transition } = useMovementMutations()

    const [note, setNote] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const cancelling = option.to === "cancelled"
    const flagged = option.flags.length > 0
    // The moves that set something off beyond the status: the plan and the
    // driver's messages, the chain below, the books. A load that starts with
    // nobody named gets only half of that — there is no phone to ask — and
    // the dialog says so rather than promising messages that never go out
    const consequence = option.startsTracking
        ? option.flags.includes("NO_DRIVER") ? "starts-tracking-undriven" : "starts-tracking"
        : option.to === "cancelled" || option.to === "closed" ? option.to : null
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
                    <DialogTitle>{moveLabel(load.status, option.to)}</DialogTitle>
                    <DialogDescription>
                        {t("transition.description", {
                            ref: load.ref,
                            from: statusLabel(load.status),
                            to: statusLabel(option.to),
                        })}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {consequence && (
                        <p className="text-muted-foreground text-sm">
                            {t(`transition.consequence.${consequence}`)}
                        </p>
                    )}

                    {flagged && (
                        <Alert variant="destructive">
                            <IconAlertTriangle />
                            <AlertTitle>{t("transition.flagged-title", { count: option.flags.length })}</AlertTitle>
                            <AlertDescription>
                                <ul className="list-disc pl-4">
                                    {option.flags.map((flag) => <li key={flag}>{flagLabel(flag)}</li>)}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* A flagged move is worth a line saying why it went ahead */}
                    {(cancelling || option.needsNote || flagged) && (
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
                        {t(flagged ? "dialogs.proceed-flagged" : "dialogs.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
