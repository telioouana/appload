"use client"

import { useState } from "react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import type { MovementDisputeView } from "@/frontend/pages/movements/types"

/** Mirrors NOTES_MAX on the dispute schema. */
const RESOLUTION_MAX = 2000

/**
 * Declaring a dispute settled, which only the company that opened it can do.
 * How it was settled is the whole point of the record, so the note is
 * required; every company the dispute covers reads it.
 */
export function ResolveDisputeDialog({ dispute, onClose }: { dispute: MovementDisputeView; onClose: () => void }) {
    const t = useTranslations("App.loads")

    const { resolveDispute } = useMovementMutations()

    const [resolution, setResolution] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    function submit() {
        setError(null)

        resolveDispute.mutate(
            { id: dispute.id, resolution: resolution.trim() },
            {
                onSuccess: onClose,
                onError: (failure) => setError(movementErrorKey(failure)),
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !resolveDispute.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("disputes.resolve.title")}</DialogTitle>
                    <DialogDescription>{t("disputes.resolve.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="dispute-resolution">{t("disputes.resolve.resolution")}</Label>
                        <Textarea
                            id="dispute-resolution"
                            value={resolution}
                            maxLength={RESOLUTION_MAX}
                            disabled={resolveDispute.isPending}
                            placeholder={t("disputes.resolve.resolution-placeholder")}
                            onChange={(event) => setResolution(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={resolveDispute.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button disabled={resolveDispute.isPending || resolution.trim().length === 0} onClick={submit}>
                        {resolveDispute.isPending && <Spinner className="size-4" />}
                        {t("disputes.resolve.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
