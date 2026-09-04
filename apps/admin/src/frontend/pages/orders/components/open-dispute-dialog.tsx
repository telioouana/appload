"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, DISPUTE_LIABLE_PARTY, DISPUTE_REASON, type DisputeLiableParty, type DisputeReason } from "@workspace/db/types"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"

type Currency = (typeof CURRENCY)[number]

const ERROR_CODES = ["DISPUTE_INVALID_ORDER", "DISPUTE_EXISTS", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

const NONE = "__none"

/**
 * Opens a dispute on one order: the cause, what happened, who is thought
 * liable, what is claimed, and which party's payments to hold (both, by
 * default — the dispute exists to stop money moving until it is settled).
 */
export function OpenDisputeDialog({
    orderId,
    currency,
    open,
    onClose,
}: {
    orderId: string
    /** The shipper leg's currency, the usual unit of a claim */
    currency: Currency | null
    open: boolean
    onClose: () => void
}) {
    const t = useTranslations("Admin.orders.dispute")
    const tValues = useTranslations("Admin.disputes.values")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [reason, setReason] = useState<DisputeReason>("damage")
    const [description, setDescription] = useState("")
    const [liable, setLiable] = useState<DisputeLiableParty | typeof NONE>(NONE)
    const [claimed, setClaimed] = useState("")
    const [claimedCurrency, setClaimedCurrency] = useState<Currency>(currency ?? "MZN")
    const [holdShipper, setHoldShipper] = useState(true)
    const [holdCarrier, setHoldCarrier] = useState(true)
    const [error, setError] = useState<(typeof ERROR_CODES)[number] | null>(null)

    const { mutateAsync, isPending } = useMutation(trpc.disputes.open.mutationOptions())

    const amount = claimed.trim() === "" ? undefined : Number(claimed)
    const amountValid = amount === undefined || (Number.isFinite(amount) && amount >= 0)
    const ready = description.trim().length >= 10 && amountValid && !isPending

    async function submit() {
        if (!ready) return
        setError(null)

        try {
            await mutateAsync({
                orderId,
                reason,
                description: description.trim(),
                claimedAmount: amount,
                claimedCurrency: amount === undefined ? undefined : claimedCurrency,
                liableParty: liable === NONE ? undefined : liable,
                holdShipperPayments: holdShipper,
                holdCarrierPayments: holdCarrier,
            })

            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
            queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))
            queryClient.invalidateQueries(trpc.orders.pathFilter())
            queryClient.invalidateQueries(trpc.disputes.pathFilter())
            toast(t("opened", { orderId }))
            onClose()
        } catch (err) {
            setError(domainErrorCode(err, ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="w-full sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t("open-title")}</DialogTitle>
                    <DialogDescription>{t("open-description", { orderId })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label>{t("reason")}</Label>
                            <Select value={reason} onValueChange={(value) => setReason(value as DisputeReason)} disabled={isPending}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent position="popper">
                                    {DISPUTE_REASON.map((value) => (
                                        <SelectItem key={value} value={value}>{tValues(`reasons.${value}`)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label>{t("liable")}</Label>
                            <Select value={liable} onValueChange={(value) => setLiable(value as DisputeLiableParty | typeof NONE)} disabled={isPending}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent position="popper">
                                    <SelectItem value={NONE}>{t("liable-none")}</SelectItem>
                                    {DISPUTE_LIABLE_PARTY.map((value) => (
                                        <SelectItem key={value} value={value}>{tValues(`liable.${value}`)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="dispute-description">{t("description")}</Label>
                        <Textarea
                            id="dispute-description"
                            rows={4}
                            maxLength={4000}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder={t("description-placeholder")}
                            disabled={isPending}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="dispute-claimed">{t("claimed")}</Label>
                            <Input
                                id="dispute-claimed"
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                value={claimed}
                                onChange={(event) => setClaimed(event.target.value)}
                                placeholder="0.00"
                                aria-invalid={!amountValid}
                                disabled={isPending}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label>{t("claimed-currency")}</Label>
                            <Select value={claimedCurrency} onValueChange={(value) => setClaimedCurrency(value as Currency)} disabled={isPending}>
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent position="popper">
                                    {CURRENCY.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border p-3">
                        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span className="flex flex-col">
                                <span>{t("hold-shipper")}</span>
                                <span className="text-muted-foreground text-xs">{t("hold-shipper-hint")}</span>
                            </span>
                            <Switch checked={holdShipper} onCheckedChange={setHoldShipper} disabled={isPending} />
                        </label>
                        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span className="flex flex-col">
                                <span>{t("hold-carrier")}</span>
                                <span className="text-muted-foreground text-xs">{t("hold-carrier-hint")}</span>
                            </span>
                            <Switch checked={holdCarrier} onCheckedChange={setHoldCarrier} disabled={isPending} />
                        </label>
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
                        {t("open")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
