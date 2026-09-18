"use client"

import { useState } from "react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { movementDocumentPath } from "@workspace/edgestore/path"
import { domainErrorCode } from "@workspace/trpc/errors"

import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { buildConfirmationPdf, confirmationFileName } from "@/frontend/pages/movements/lib/confirmation-pdf"
import type { MovementDetail } from "@/frontend/pages/movements/types"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MESSAGE_MAX = 500

/** The three waits, in the order the reader goes through them. */
type Stage = "generating" | "uploading" | "sending"

/**
 * Sending the partner its confirmation. The PDF is filled here in the
 * browser, uploaded to EdgeStore and only then handed to the server, which
 * attaches it to the email and files it on the load — so a failed upload
 * never leaves a paper on the load that nobody can open, and a sent email
 * always has the document behind it.
 */
export function SendConfirmationDialog({
    load,
    companyName,
    onClose,
}: {
    load: MovementDetail
    companyName: string
    onClose: () => void
}) {
    const t = useTranslations("App.loads")

    const { edgestore } = useEdgeStore()
    const { sendConfirmation } = useMovementMutations()

    const [to, setTo] = useState(load.carrierEmail ?? "")
    const [cc, setCc] = useState("")
    const [message, setMessage] = useState("")
    const [stage, setStage] = useState<Stage | null>(null)
    const [error, setError] = useState<"email" | "failed" | null>(null)

    const filename = confirmationFileName(load)

    const ccList = cc.split(",").map((entry) => entry.trim()).filter(Boolean)
    const ccValid = ccList.length <= 5 && ccList.every((entry) => EMAIL_RE.test(entry))
    const ready = EMAIL_RE.test(to.trim()) && ccValid

    async function submit() {
        if (!ready || stage) return

        setError(null)

        try {
            setStage("generating")
            const pdf = await buildConfirmationPdf(load, companyName)

            setStage("uploading")
            const { url } = await edgestore.apploadFiles.upload({
                file: new File([pdf], filename, { type: "application/pdf" }),
                input: { path: movementDocumentPath(load.id, "transport-order") },
            })

            if (!url) {
                setError("failed")
                return
            }

            setStage("sending")
            await sendConfirmation.mutateAsync({
                id: load.id,
                url,
                filename,
                to: to.trim(),
                cc: ccList,
                message: message.trim() || undefined,
            })

            onClose()
        } catch (failure) {
            console.error(failure)
            setError(domainErrorCode(failure, ["EMAIL_FAILED"], "FAILED") === "EMAIL_FAILED" ? "email" : "failed")
        } finally {
            setStage(null)
        }
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !stage) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("confirmation.title")}</DialogTitle>
                    <DialogDescription>
                        {t("confirmation.description", { ref: load.ref, partner: load.carrier?.name ?? "" })}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirmation-to">{t("confirmation.to")}</Label>
                        <Input
                            id="confirmation-to"
                            type="email"
                            value={to}
                            disabled={stage !== null}
                            onChange={(event) => setTo(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">{filename}</p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirmation-cc">{t("confirmation.cc")}</Label>
                        <Input
                            id="confirmation-cc"
                            value={cc}
                            disabled={stage !== null}
                            aria-invalid={cc.length > 0 && !ccValid}
                            onChange={(event) => setCc(event.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirmation-message">{t("confirmation.message")}</Label>
                        <Textarea
                            id="confirmation-message"
                            value={message}
                            maxLength={MESSAGE_MAX}
                            disabled={stage !== null}
                            placeholder={t("confirmation.message-placeholder")}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`confirmation.errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={stage !== null} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button disabled={!ready || stage !== null} onClick={() => void submit()}>
                        {stage !== null && <Spinner className="size-4" />}
                        {stage === null ? t("confirmation.send") : t(`confirmation.${stage}`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
