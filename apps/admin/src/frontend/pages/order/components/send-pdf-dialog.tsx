"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconBrandWhatsapp, IconDownload, IconMail } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Label } from "@workspace/ui/components/label"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
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
import { fillOrderTemplate, orderToTemplateValues, pdfFileName, type TemplateKind } from "@/lib/orders/pdf"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Generates the party's transport-order PDF in the browser (same pdf-lib
 * flow as the booking dialogs) and either emails it (Resend, with manual
 * CCs), shares it via WhatsApp (public EdgeStore URL in a wa.me draft) or
 * downloads it. Filenames carry the party's name.
 */
export function SendPdfDialog({
    order,
    open,
    onClose,
}: {
    order: Order
    open: boolean
    onClose: () => void
}) {
    const t = useTranslations("Admin.orders.pdfSend")

    const [party, setParty] = useState<TemplateKind>("shipper")
    const [to, setTo] = useState("")
    const [cc, setCc] = useState("")
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState<"email" | "whatsapp" | "download" | null>(null)
    const [error, setError] = useState<"UPLOAD_FAILED" | "SEND_FAILED" | null>(null)

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()
    const { mutateAsync: sendPdf } = useMutation(trpc.order.sendPdf.mutationOptions())

    const partyName = party === "shipper" ? order.shipperName : order.carrierName
    const filename = pdfFileName(party, order.orderId, partyName)

    const ccList = cc.split(",").map((entry) => entry.trim()).filter(Boolean)
    const ccValid = ccList.every((entry) => EMAIL_RE.test(entry)) && ccList.length <= 5
    const emailReady = EMAIL_RE.test(to.trim()) && ccValid

    async function generate(): Promise<Blob> {
        return fillOrderTemplate(party, order.orderId, orderToTemplateValues(order, null))
    }

    async function upload(blob: Blob): Promise<string | null> {
        const { url } = await edgestore.apploadFiles.upload({
            file: new File([blob], filename, { type: "application/pdf" }),
            input: { path: orderDocumentPath(order.orderId, "transport-order") },
        })
        return url ?? null
    }

    async function onEmail() {
        if (!emailReady || busy) return
        setBusy("email")
        setError(null)

        try {
            const url = await upload(await generate())
            if (!url) { setError("UPLOAD_FAILED"); return }

            const result = await sendPdf({
                orderId: order.orderId,
                party,
                url,
                filename,
                to: to.trim(),
                cc: ccList,
                message: message.trim() || undefined,
            })

            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
            toast(result.simulated ? t("sentSimulated") : t("sent"))
            onClose()
        } catch (err) {
            console.error(err)
            setError("SEND_FAILED")
        } finally {
            setBusy(null)
        }
    }

    async function onWhatsApp() {
        if (busy) return
        setBusy("whatsapp")
        setError(null)

        try {
            const url = await upload(await generate())
            if (!url) { setError("UPLOAD_FAILED"); return }

            const text = `${message.trim() || t("waDefaultMessage", { orderId: order.orderId })} ${url}`
            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")
            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
        } catch (err) {
            console.error(err)
            setError("SEND_FAILED")
        } finally {
            setBusy(null)
        }
    }

    async function onDownload() {
        if (busy) return
        setBusy("download")
        setError(null)

        try {
            const blob = await generate()
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement("a")
            anchor.href = url
            anchor.download = filename
            anchor.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error(err)
            setError("SEND_FAILED")
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { orderId: order.orderId })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>{t("partyLabel")}</Label>
                        <Select value={party} onValueChange={(value) => setParty(value as TemplateKind)}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent position="popper">
                                <SelectItem value="shipper">{t("parties.shipper", { name: order.shipperName })}</SelectItem>
                                <SelectItem value="carrier" disabled={!order.carrierName}>
                                    {t("parties.carrier", { name: order.carrierName ?? "—" })}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{filename}</p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="pdf-to">{t("toLabel")}</Label>
                        <Input
                            id="pdf-to"
                            type="email"
                            value={to}
                            onChange={(event) => setTo(event.target.value)}
                            placeholder={t("toPlaceholder")}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="pdf-cc">{t("ccLabel")}</Label>
                        <Input
                            id="pdf-cc"
                            value={cc}
                            onChange={(event) => setCc(event.target.value)}
                            placeholder={t("ccPlaceholder")}
                            aria-invalid={cc.length > 0 && !ccValid}
                        />
                        <p className="text-xs text-muted-foreground">{t("ccHint")}</p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="pdf-message">{t("messageLabel")}</Label>
                        <Textarea
                            id="pdf-message"
                            rows={2}
                            maxLength={2000}
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder={t("messagePlaceholder")}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="ghost" onClick={onDownload} disabled={busy !== null}>
                        {busy === "download" ? <Spinner /> : <IconDownload />}
                        {t("download")}
                    </Button>
                    <Button type="button" variant="outline" onClick={onWhatsApp} disabled={busy !== null}>
                        {busy === "whatsapp" ? <Spinner /> : <IconBrandWhatsapp />}
                        {t("whatsapp")}
                    </Button>
                    <Button type="button" onClick={onEmail} disabled={!emailReady || busy !== null}>
                        {busy === "email" ? <Spinner /> : <IconMail />}
                        {t("email")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
