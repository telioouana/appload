"use client"

import { useState } from "react"

import { useTranslations } from "@workspace/i18n"

import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { orderErrorKey, orderErrorCode, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { CANCEL_NOTE_MAX, CANCEL_NOTE_MIN } from "@/backend/schemas/order"

/**
 * Calling the cargo off. Only a prospect or a booked order can be cancelled,
 * and only with a reason: the note is the record of why the load went away,
 * and the carriers that were asked are told.
 */
export function CancelOrderDialog({
    orderId,
    expectedVersion,
    open,
    onOpenChange,
}: {
    orderId: string
    expectedVersion: number
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.orders.cancel")
    const tError = useTranslations("App.orders")

    const { cancel, refresh } = useOrderMutations()

    const [note, setNote] = useState("")
    const [error, setError] = useState<OrderErrorMessage | null>(null)

    function confirm() {
        setError(null)

        cancel.mutate(
            { orderId, expectedVersion, note: note.trim() },
            {
                onSuccess: () => {
                    setNote("")
                    onOpenChange(false)
                },
                onError: (failure) => {
                    setError(orderErrorKey(failure))

                    // The page was built from a version that has since moved
                    // on; refetch so a second attempt runs on the current one
                    if (orderErrorCode(failure) === "VERSION_CONFLICT") void refresh()
                },
            },
        )
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next) }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { orderId })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    <Label htmlFor="cancel-note">{t("note.label")}</Label>
                    <Textarea
                        id="cancel-note"
                        autoFocus
                        value={note}
                        rows={3}
                        maxLength={CANCEL_NOTE_MAX}
                        placeholder={t("note.placeholder")}
                        disabled={cancel.isPending}
                        onChange={(event) => setNote(event.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">{t("note.hint", { min: CANCEL_NOTE_MIN })}</p>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={cancel.isPending} onClick={() => onOpenChange(false)}>
                        {t("back")}
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={cancel.isPending || note.trim().length < CANCEL_NOTE_MIN}
                        onClick={confirm}
                    >
                        {cancel.isPending && <Spinner className="size-4" />}
                        {t("confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
