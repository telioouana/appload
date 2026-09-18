"use client"

import { useState } from "react"
import { IconUsers } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { DISPUTE_REASON, type DisputeReason } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import type { MovementDetail } from "@/frontend/pages/movements/types"

/** Mirrors NOTES_MAX on the dispute schema. */
const DESCRIPTION_MAX = 2000

/**
 * Saying something went wrong with a load — the cargo stolen, lost, damaged,
 * or anything else that has to be settled before the books are. The
 * dispute covers the load in every company's books along the chain, and
 * what is written here reaches each of them word for word, so the dialog
 * says that before it is sent rather than after.
 */
export function OpenDisputeDialog({ load, onClose }: { load: MovementDetail; onClose: () => void }) {
    const t = useTranslations("App.loads")

    const { openDispute } = useMovementMutations()

    const [reason, setReason] = useState<DisputeReason | "">("")
    const [description, setDescription] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const ready = reason !== "" && description.trim().length > 0

    function submit() {
        if (reason === "") return

        setError(null)

        openDispute.mutate(
            { movementId: load.id, reason, description: description.trim() },
            {
                onSuccess: onClose,
                onError: (failure) => setError(movementErrorKey(failure)),
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !openDispute.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("disputes.open.title")}</DialogTitle>
                    <DialogDescription>{t("disputes.open.description", { ref: load.ref })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>{t("disputes.open.reason")}</Label>
                        <Select value={reason} onValueChange={(value) => setReason(value as DisputeReason)} disabled={openDispute.isPending}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={t("disputes.open.reason-placeholder")} />
                            </SelectTrigger>
                            <SelectContent position="popper">
                                {DISPUTE_REASON.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {t(`disputes.reasons.${value}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="dispute-description">{t("disputes.open.details")}</Label>
                        <Textarea
                            id="dispute-description"
                            value={description}
                            maxLength={DESCRIPTION_MAX}
                            disabled={openDispute.isPending}
                            placeholder={t("disputes.open.details-placeholder")}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <IconUsers className="size-3.5 shrink-0" stroke={1.5} />
                            {t("disputes.open.shared")}
                        </p>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={openDispute.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button variant="destructive" disabled={openDispute.isPending || !ready} onClick={submit}>
                        {openDispute.isPending && <Spinner className="size-4" />}
                        {t("disputes.open.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
