"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME } from "@workspace/db/types"
import { VAT_RATE } from "@workspace/domain/orders/commission"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { SelectItem } from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { FieldGroup } from "@workspace/ui/components/field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { SelectInput } from "@workspace/ui/inputs/select"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import type { MovementDetail } from "@/frontend/pages/movements/types"

const NOTE_MAX = 500

const round = (value: number) => Math.round(value * 100) / 100

/** The price as typed: a positive number, its currency, and the regime the VAT is derived from. */
const QuoteFormSchema = z.object({
    total: z.string().refine((value) => Number(value) > 0 && Number(value) <= 1e12),
    currency: z.enum(CURRENCY),
    fiscalRegime: z.enum(FISCAL_REGIME).optional(),
})

type QuoteForm = z.infer<typeof QuoteFormSchema>

/**
 * A transporter's answer to a load it was asked to price: the figure it
 * would move it for, or a no. The price goes back VAT-inclusive with the
 * split derived from the regime, the way the load form writes a leg; the
 * owner reads it beside the other quotes and awards one.
 */
export function QuoteDialog({
    load,
    decision,
    onClose,
}: {
    load: MovementDetail
    decision: "quote" | "decline"
    onClose: () => void
}) {
    const t = useTranslations("App.loads")
    const tv = useTranslations("App.orders")

    const { quote, declineRequest } = useMovementMutations()

    const [note, setNote] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const quoting = decision === "quote"
    const pending = quote.isPending || declineRequest.isPending

    const form = useForm<QuoteForm>({
        resolver: zodResolver(QuoteFormSchema),
        defaultValues: { total: "", currency: "MZN", fiscalRegime: undefined },
    })

    const fail = (failure: unknown) => setError(movementErrorKey(failure))

    function submitQuote(values: QuoteForm) {
        setError(null)

        const amount = Number(values.total)
        const vat = values.fiscalRegime === undefined ? undefined : values.fiscalRegime === "normal" ? round(amount * VAT_RATE) : 0

        quote.mutate(
            {
                id: load.id,
                quote: {
                    total: amount,
                    currency: values.currency,
                    ...(values.fiscalRegime && { fiscalRegime: values.fiscalRegime }),
                    ...(vat !== undefined && { vat, subtotal: round(amount - vat) }),
                },
                note: note.trim() || undefined,
            },
            { onSuccess: onClose, onError: fail },
        )
    }

    function submitDecline() {
        setError(null)
        declineRequest.mutate({ id: load.id, note: note.trim() || undefined }, { onSuccess: onClose, onError: fail })
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(quoting ? "quotes.quote.title" : "quotes.quote.decline-title")}</DialogTitle>
                    <DialogDescription>
                        {t(quoting ? "quotes.quote.description" : "quotes.quote.decline-description", {
                            ref: load.ref,
                            owner: load.owner?.name ?? "",
                        })}
                    </DialogDescription>
                </DialogHeader>

                <form
                    id="quote-form"
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.stopPropagation()
                        if (quoting) void form.handleSubmit(submitQuote)(event)
                        else { event.preventDefault(); submitDecline() }
                    }}
                >
                    {quoting && (
                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                            <DecimalInput
                                name="total"
                                control={form.control}
                                isPending={pending}
                                label={t("form.fields.total")}
                                placeholder={t("form.fields.total-placeholder")}
                            />
                            <SelectInput name="currency" control={form.control} isPending={pending} label={t("form.fields.currency")}>
                                {CURRENCY.map((item) => (
                                    <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                                ))}
                            </SelectInput>
                            <SelectInput
                                name="fiscalRegime"
                                control={form.control}
                                isPending={pending}
                                label={t("form.fields.fiscal-regime")}
                                placeholder={t("form.fields.fiscal-regime-placeholder")}
                            >
                                {FISCAL_REGIME.map((item) => (
                                    <SelectItem key={item} value={item}>{tv(`fiscalRegime.${item}`)}</SelectItem>
                                ))}
                            </SelectInput>
                        </FieldGroup>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="quote-note">{t("respond.note")}</Label>
                        <Textarea
                            id="quote-note"
                            value={note}
                            maxLength={NOTE_MAX}
                            disabled={pending}
                            placeholder={t(quoting ? "quotes.quote.placeholder" : "respond.decline-placeholder")}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button type="submit" form="quote-form" variant={quoting ? "default" : "destructive"} disabled={pending}>
                        {pending && <Spinner className="size-4" />}
                        {t(quoting ? "quotes.quote.submit" : "actions.decline")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
