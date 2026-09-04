"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconMail, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Label } from "@workspace/ui/components/label"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { fillOrderTemplate, orderToTemplateValues, pdfFileName, type TemplateKind } from "@/lib/orders/pdf"
import type { OrderRow } from "@/frontend/pages/orders/types"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type RowState = "idle" | "skipped" | "generating" | "uploading" | "sending" | "sent" | "failed"

/**
 * The transport-order PDF for several orders at once: one party, one
 * message, one address per order prefilled from the party's registry
 * entry. Each order is generated in the browser, uploaded and emailed in
 * turn, so a failure on one never touches the others.
 */
export function BulkSendPdfDialog({ rows, open, onClose }: { rows: OrderRow[]; open: boolean; onClose: () => void }) {
    const t = useTranslations("Admin.orders.bulkPdf")
    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()
    const { mutateAsync: sendPdf } = useMutation(trpc.order.sendPdf.mutationOptions())

    const [party, setParty] = useState<TemplateKind>("shipper")
    const [cc, setCc] = useState("")
    const [message, setMessage] = useState("")
    // Addresses the operator typed over the registry defaults
    const [overrides, setOverrides] = useState<Record<string, string>>({})
    const [states, setStates] = useState<Record<string, RowState>>({})
    const [running, setRunning] = useState(false)
    const [finished, setFinished] = useState(false)

    const contacts = useQuery({
        ...trpc.orders.partyContacts.queryOptions({ orderIds: rows.map((row) => row.orderId) }),
        enabled: open && rows.length > 0,
    })

    // The registry prefills each row; whatever the operator typed wins
    const defaults = useMemo(() => Object.fromEntries((contacts.data ?? []).map((entry) => [
        entry.orderId,
        (party === "shipper" ? entry.shipper.email : entry.carrier?.email) ?? "",
    ])), [contacts.data, party])
    const recipients: Record<string, string> = { ...defaults, ...overrides }

    const changeParty = (next: TemplateKind) => {
        setParty(next)
        setOverrides({})
        setStates({})
        setFinished(false)
    }

    const ccList = cc.split(",").map((entry) => entry.trim()).filter(Boolean)
    const ccValid = ccList.every((entry) => EMAIL_RE.test(entry)) && ccList.length <= 5

    const sendable = rows.filter((row) => EMAIL_RE.test((recipients[row.orderId] ?? "").trim()) && (party === "shipper" || row.carrierName))
    const ready = sendable.length > 0 && ccValid && !running

    const mark = (orderId: string, state: RowState) => setStates((current) => ({ ...current, [orderId]: state }))

    async function run() {
        if (!ready) return
        setRunning(true)

        for (const row of rows) {
            if (!sendable.includes(row)) {
                mark(row.orderId, "skipped")
                continue
            }

            try {
                mark(row.orderId, "generating")
                const { order } = await queryClient.fetchQuery(trpc.order.get.queryOptions({ orderId: row.orderId }))
                const partyName = party === "shipper" ? order.shipperName : order.carrierName
                const filename = pdfFileName(party, order.orderId, partyName)
                const blob = await fillOrderTemplate(party, order.orderId, orderToTemplateValues(order, null))

                mark(row.orderId, "uploading")
                const { url } = await edgestore.apploadFiles.upload({
                    file: new File([blob], filename, { type: "application/pdf" }),
                    input: { path: orderDocumentPath(order.orderId, "transport-order") },
                })
                if (!url) throw new Error("UPLOAD_FAILED")

                mark(row.orderId, "sending")
                await sendPdf({
                    orderId: order.orderId,
                    party,
                    url,
                    filename,
                    to: (recipients[row.orderId] ?? "").trim(),
                    cc: ccList,
                    message: message.trim() || undefined,
                })

                queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
                mark(row.orderId, "sent")
            } catch (error) {
                console.error(`bulk pdf failed for ${row.orderId}`, error)
                mark(row.orderId, "failed")
            }
        }

        queryClient.invalidateQueries(trpc.orders.pathFilter())
        setRunning(false)
        setFinished(true)
    }

    const done = Object.values(states).filter((state) => state === "sent" || state === "failed" || state === "skipped").length

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !running) onClose() }}>
            <DialogContent className="w-full sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { count: rows.length })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label>{t("party")}</Label>
                            <Select value={party} onValueChange={(value) => changeParty(value as TemplateKind)} disabled={running}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent position="popper">
                                    <SelectItem value="shipper">{t("parties.shipper")}</SelectItem>
                                    <SelectItem value="carrier">{t("parties.carrier")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="bulk-pdf-cc">{t("cc")}</Label>
                            <Input
                                id="bulk-pdf-cc"
                                value={cc}
                                onChange={(event) => setCc(event.target.value)}
                                placeholder={t("cc-placeholder")}
                                aria-invalid={cc.length > 0 && !ccValid}
                                disabled={running}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="bulk-pdf-message">{t("message")}</Label>
                        <Textarea
                            id="bulk-pdf-message"
                            rows={2}
                            maxLength={2000}
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder={t("message-placeholder")}
                            disabled={running}
                        />
                    </div>

                    <div className="max-h-72 overflow-y-auto rounded-xl border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-muted-foreground text-xs">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">{t("order")}</th>
                                    <th className="px-3 py-2 text-left font-medium">{t("to")}</th>
                                    <th className="px-3 py-2 text-right font-medium">{t("state")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => {
                                    const partyName = party === "shipper" ? row.shipperName : row.carrierName
                                    const address = recipients[row.orderId] ?? ""
                                    const valid = EMAIL_RE.test(address.trim())
                                    // A row that cannot be sent reads as skipped before the run too
                                    const state = states[row.orderId] ?? (sendable.includes(row) ? "idle" : "skipped")

                                    return (
                                        <tr key={row.orderId} className="border-t">
                                            <td className="px-3 py-2 align-top">
                                                <div className="font-mono">{row.orderId}</div>
                                                <div className="text-muted-foreground truncate text-xs">{partyName ?? t("no-carrier")}</div>
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                {party === "carrier" && !row.carrierName ? (
                                                    <span className="text-muted-foreground text-xs">{t("no-carrier")}</span>
                                                ) : (
                                                    <Input
                                                        type="email"
                                                        value={address}
                                                        onChange={(event) => setOverrides((current) => ({ ...current, [row.orderId]: event.target.value }))}
                                                        placeholder={t("no-email")}
                                                        aria-invalid={address.length > 0 && !valid}
                                                        disabled={running || state === "sent"}
                                                        className="h-8"
                                                    />
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right align-top">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1 text-xs",
                                                    state === "sent" && "text-emerald-600",
                                                    state === "failed" && "text-destructive",
                                                    (state === "idle" || state === "skipped") && "text-muted-foreground",
                                                )}>
                                                    {(state === "generating" || state === "uploading" || state === "sending") && <Spinner className="size-3" />}
                                                    {state === "sent" && <IconCheck className="size-3.5" stroke={2} />}
                                                    {state === "failed" && <IconX className="size-3.5" stroke={2} />}
                                                    {t(`states.${state}`)}
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:items-center">
                    {(running || finished) && (
                        <span className="text-muted-foreground mr-auto text-xs tabular-nums">{t("progress", { done, total: rows.length })}</span>
                    )}
                    <Button type="button" variant="outline" onClick={onClose} disabled={running}>
                        {finished ? t("close") : t("cancel")}
                    </Button>
                    {!finished && (
                        <Button type="button" onClick={run} disabled={!ready}>
                            {running ? <Spinner /> : <IconMail />}
                            {t("send", { count: sendable.length })}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
