"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconAlertTriangle, IconUpload, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@workspace/ui/components/dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import type { OrderStatus } from "@/lib/orders/transitions"

const DIALOG_ERROR_CODES = [
    "INVALID_STATE", "NOT_ALLOWED", "VERSION_CONFLICT",
    "NOTE_REQUIRED", "EVIDENCE_REQUIRED", "POD_REQUIRED",
    "INCOMPLETE_FOR_BOOKING", "NOT_FOUND", "UPLOAD_FAILED", "UNKNOWN",
    // Verification gate, raised when booking commits cargo to a carrier
    "CARRIER_NOT_VERIFIED", "CARRIER_CONTRACT_MISSING", "CARRIER_CONTRACT_EXPIRED",
    "CARRIER_SUSPENDED", "RISK_ACK_NOT_ALLOWED", "RISK_ACK_NOTE_REQUIRED",
] as const;

type DialogErrorCode = (typeof DIALOG_ERROR_CODES)[number];

const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"];

/**
 * The one door for status changes in the UI. Targets, requirements and the
 * lock version all come from order.transitionOptions — the dialog never
 * guesses what is legal ("the server re-guards every transition — this is
 * presentation, not authority"). Moves that demand a document keep the
 * confirm button disabled until the file is picked; the upload happens on
 * confirm, before the mutation, so no orphan transitions exist.
 */
export function TransitionDialog({
    orderId,
    open,
    initialTarget,
    onClose,
    onSuccess,
}: {
    orderId: string
    open: boolean
    initialTarget?: OrderStatus
    onClose: () => void
    onSuccess?: (order: Order) => void
}) {
    const t = useTranslations("Admin.orders.transitionDialog")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")

    const [target, setTarget] = useState<OrderStatus | undefined>(initialTarget)
    const [note, setNote] = useState("")
    const [file, setFile] = useState<File | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<DialogErrorCode | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()

    const options = useQuery(trpc.order.transitionOptions.queryOptions(
        { orderId },
        { enabled: open },
    ))

    const { mutateAsync } = useMutation(trpc.order.transition.mutationOptions())

    // Reset per open so a reused dialog never carries a stale note/file
    useEffect(() => {
        if (open) {
            setTarget(initialTarget)
            setNote("")
            setFile(null)
            setError(null)
        }
    }, [open, initialTarget])

    const targets = options.data?.targets ?? []
    const selected = targets.find((entry) => entry.to === target)
    const requirements = selected?.requirements ?? []

    const needsNote = requirements.includes("note")
    const needsDocument = requirements.includes("evidence") || requirements.includes("pod")
    const documentKind = requirements.includes("pod") ? "pod" : "evidence"

    // Advertised so the operator sees the move exists, but the stored row
    // cannot carry it yet — "Confirm order" opens the form that can
    const blocked = selected?.blocked ?? false

    const ready =
        Boolean(selected) &&
        !blocked &&
        (!needsNote || note.trim().length >= 5) &&
        (!needsDocument || file !== null)

    async function confirm() {
        if (!selected || !options.data || submitting) return

        setSubmitting(true)
        setError(null)

        try {
            let document: { url: string; name?: string; size?: number; mimeType?: string } | undefined

            if (needsDocument && file) {
                const { url } = await edgestore.apploadFiles.upload({
                    file,
                    input: { path: orderDocumentPath(orderId, documentKind) },
                })

                if (!url) {
                    setError("UPLOAD_FAILED")
                    return
                }

                document = { url, name: file.name, size: file.size, mimeType: file.type }
            }

            const result = await mutateAsync({
                orderId,
                to: selected.to,
                expectedVersion: options.data.version,
                note: note.trim() || undefined,
                document,
            })

            queryClient.invalidateQueries(trpc.orders.list.queryFilter())
            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
            queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))

            if (result.warning === "SHEET_FAILED") {
                toast(t("sheetWarning"))
            }

            onSuccess?.(result.order)
            onClose()
        } catch (err) {
            const code = domainErrorCode(err, DIALOG_ERROR_CODES, "UNKNOWN")
            setError(code)

            if (code === "VERSION_CONFLICT") {
                options.refetch()
            }
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { orderId })}</DialogDescription>
                </DialogHeader>

                {options.isPending ? (
                    <div className="flex justify-center py-6"><Spinner /></div>
                ) : targets.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">{t("noTargets")}</p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label>{t("targetLabel")}</Label>
                            <Select
                                value={target}
                                onValueChange={(value) => setTarget(value as OrderStatus)}
                                disabled={submitting}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("targetPlaceholder")} />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    {targets.map((entry) => (
                                        <SelectItem key={entry.to} value={entry.to}>
                                            {tStatus(entry.to)}
                                            {entry.to === options.data?.resumeStatus && ` — ${t("resumeHint")}`}
                                            {entry.blocked && ` — ${t("blockedHint")}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {blocked && (
                            <Alert variant="destructive">
                                <AlertDescription>{t("errors.INCOMPLETE_FOR_BOOKING")}</AlertDescription>
                            </Alert>
                        )}

                        {requirements.includes("flag") && (
                            <Alert>
                                <IconAlertTriangle />
                                <AlertDescription>{t("flagWarning")}</AlertDescription>
                            </Alert>
                        )}

                        {needsNote && (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="transition-note">{t("noteLabel")}</Label>
                                <Textarea
                                    id="transition-note"
                                    value={note}
                                    rows={3}
                                    maxLength={2000}
                                    onChange={(event) => setNote(event.target.value)}
                                    placeholder={t("notePlaceholder")}
                                    disabled={submitting}
                                />
                            </div>
                        )}

                        {needsDocument && (
                            <div className="flex flex-col gap-2">
                                <Label>{t(`documentLabel.${documentKind}`)}</Label>
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        className="hidden"
                                        accept={ACCEPTED_FILES.join(",")}
                                        onChange={(event) => {
                                            const picked = event.target.files?.[0] ?? null
                                            if (picked && !ACCEPTED_FILES.includes(picked.type)) {
                                                toast(t("fileFormatError"))
                                                return
                                            }
                                            setFile(picked)
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={submitting}
                                        onClick={() => fileRef.current?.click()}
                                    >
                                        <IconUpload />
                                        {file ? t("replaceFile") : t("pickFile")}
                                    </Button>
                                    {file && (
                                        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                                            <span className="truncate">{file.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setFile(null)}
                                                disabled={submitting}
                                                aria-label={t("removeFile")}
                                            >
                                                <IconX className="size-3.5" />
                                            </button>
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">{t("documentHint")}</p>
                            </div>
                        )}

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </div>
                )}

                <DialogFooter className={cn("gap-2", targets.length === 0 && "sm:justify-end")}>
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        {t("cancel")}
                    </Button>
                    {targets.length > 0 && (
                        <Button type="button" onClick={confirm} disabled={!ready || submitting}>
                            {submitting && <Spinner />}
                            {t("confirm")}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
