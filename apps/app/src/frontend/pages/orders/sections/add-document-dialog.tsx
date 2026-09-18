"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { IconUpload, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"

import { orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { PARTNER_DOCUMENT_TYPES, type PartnerDocumentType } from "@/backend/schemas/dispatch"

/** What the bucket accepts, and what the order's proof is worth reading in. */
export const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]

/**
 * Attaching a file to the order. The upload lands in EdgeStore first and the
 * document row is written with the URL it returns, so a failed upload never
 * leaves a document pointing nowhere.
 *
 * A client may only attach evidence — the proof of delivery is the carrier's
 * to produce, and the procedure refuses anything else from that side.
 */
export function AddDocumentDialog({
    orderId,
    types,
    open,
    onOpenChange,
}: {
    orderId: string
    /** The types this side may file; a single one is not asked about */
    types: readonly PartnerDocumentType[]
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.orders.documents")
    const tError = useTranslations("App.orders")

    const { edgestore } = useEdgeStore()
    const { addDocument } = useOrderMutations()

    const [type, setType] = useState<PartnerDocumentType>(types[0] ?? PARTNER_DOCUMENT_TYPES[0])
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<OrderErrorMessage | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const isPending = uploading || addDocument.isPending

    async function submit() {
        if (!file || isPending) return

        setError(null)
        setUploading(true)

        try {
            const { url } = await edgestore.apploadFiles.upload({
                file,
                input: { path: orderDocumentPath(orderId, type) },
            })

            if (!url) {
                setError("uploadFailed")
                return
            }

            addDocument.mutate(
                { orderId, type, url, title: file.name, size: file.size, mimeType: file.type },
                {
                    onSuccess: () => {
                        setFile(null)
                        onOpenChange(false)
                    },
                    onError: (failure) => setError(orderErrorKey(failure)),
                },
            )
        } catch (failure) {
            console.error(failure)
            setError("uploadFailed")
        } finally {
            setUploading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next) }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("add.title")}</DialogTitle>
                    <DialogDescription>{t("add.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {types.length > 1 && (
                        <div className="flex flex-col gap-2">
                            <Label>{t("add.type")}</Label>
                            <Select
                                value={type}
                                onValueChange={(value) => setType(value as PartnerDocumentType)}
                                disabled={isPending}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    {types.map((value) => (
                                        <SelectItem key={value} value={value}>{t(`types.${value}`)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label>{t("add.file")}</Label>
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                className="hidden"
                                accept={ACCEPTED_FILES.join(",")}
                                onChange={(event) => {
                                    const picked = event.target.files?.[0] ?? null

                                    if (picked && !ACCEPTED_FILES.includes(picked.type)) {
                                        toast.error(t("add.format"))
                                        return
                                    }

                                    setFile(picked)
                                }}
                            />

                            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileRef.current?.click()}>
                                <IconUpload />
                                {file ? t("add.replace") : t("add.pick")}
                            </Button>

                            {file && (
                                <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                                    <span className="truncate">{file.name}</span>
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        aria-label={t("add.remove")}
                                        onClick={() => setFile(null)}
                                    >
                                        <IconX className="size-3.5" />
                                    </button>
                                </span>
                            )}
                        </div>
                        <p className="text-muted-foreground text-xs">{t("add.hint")}</p>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        {t("add.cancel")}
                    </Button>
                    <Button disabled={!file || isPending} onClick={() => void submit()}>
                        {isPending && <Spinner className="size-4" />}
                        {t("add.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
