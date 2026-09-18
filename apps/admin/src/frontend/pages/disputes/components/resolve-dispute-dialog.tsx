"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@workspace/trpc/errors"

const ERROR_CODES = ["VERSION_CONFLICT", "DISPUTE_CLOSED", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

/**
 * Settles or closes a dispute with a note. Both lift the payment holds and
 * let the order complete; "settled" says an outcome was agreed, "closed"
 * that it was dropped. The carrier debt terms come in the next stage.
 */
export function ResolveDisputeDialog({
    id,
    orderId,
    expectedVersion,
    open,
    onClose,
}: {
    id: string
    orderId: string
    expectedVersion: number
    open: boolean
    onClose: () => void
}) {
    const t = useTranslations("Admin.disputes.resolve")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [status, setStatus] = useState<"settled" | "closed">("settled")
    const [resolution, setResolution] = useState("")
    const [error, setError] = useState<(typeof ERROR_CODES)[number] | null>(null)

    const { mutateAsync, isPending } = useMutation(trpc.disputes.resolve.mutationOptions())

    const ready = resolution.trim().length >= 5 && !isPending

    async function submit() {
        if (!ready) return
        setError(null)

        try {
            await mutateAsync({ id, expectedVersion, status, resolution: resolution.trim() })

            queryClient.invalidateQueries(trpc.disputes.pathFilter())
            queryClient.invalidateQueries(trpc.orders.pathFilter())
            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
            queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))
            toast(t("done"))
            onClose()
        } catch (err) {
            setError(domainErrorCode(err, ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { orderId })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>{t("status")}</Label>
                        <Select value={status} onValueChange={(value) => setStatus(value as "settled" | "closed")} disabled={isPending}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent position="popper">
                                <SelectItem value="settled">{t("settled")}</SelectItem>
                                <SelectItem value="closed">{t("closed")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="dispute-resolution">{t("resolution")}</Label>
                        <Textarea
                            id="dispute-resolution"
                            rows={4}
                            maxLength={4000}
                            value={resolution}
                            onChange={(event) => setResolution(event.target.value)}
                            placeholder={t("placeholder")}
                            disabled={isPending}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>{t("cancel")}</Button>
                    <Button type="button" onClick={submit} disabled={!ready}>
                        {isPending && <Spinner />}
                        {t("confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
