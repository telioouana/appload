"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconMapPin, IconShieldCheck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME } from "@workspace/db/types"
import { VAT_RATE } from "@workspace/domain/orders/commission"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SelectItem } from "@workspace/ui/components/select"
import { SelectInput } from "@workspace/ui/inputs/select"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { FieldGroup } from "@workspace/ui/components/field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import type { Currency, OrderOfferView } from "@/frontend/pages/orders/types"
import {
    OfferValuesSchema,
    type OfferMessageField,
    type OfferValuesForm,
    type OfferValuesFormInput,
} from "@/backend/schemas/offer"

const round = (value: number) => value.toFixed(2)

const defaults = (currency: Currency, offer: OrderOfferView | null): OfferValuesFormInput => ({
    fiscalRegime: offer?.fiscalRegime ?? undefined as never,
    subtotal: offer?.subtotal ?? undefined,
    vat: offer?.vat ?? undefined,
    total: offer?.total ?? undefined,
    currency: offer?.currency ?? currency,
    includesGit: offer?.includesGit ?? false,
    includesGps: offer?.includesGps ?? false,
    notes: offer?.notes ?? "",
})

/**
 * What the carrier is asking to carry this load. One number: the price is
 * quoted VAT-inclusive and the split is derived from the fiscal regime —
 * only "normal" charges VAT — so the two figures under it are shown, not
 * typed.
 *
 * Appload's commission is not here and never will be: the portal sends none,
 * and staff price the deal in Admin. What the client sees is that price
 * until they do.
 */
export function OfferFormDialog({
    orderId,
    offer,
    currency,
    open,
    onOpenChange,
}: {
    orderId: string
    /** Set when correcting a quote that is still pending */
    offer: OrderOfferView | null
    /** What the order is priced in, as the opening currency of a new quote */
    currency: Currency
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.orders.offers")
    const tv = useTranslations("App.orders")
    const tError = useTranslations("App.orders")

    const { createOffer, updateOffer } = useOrderMutations()
    const isPending = createOffer.isPending || updateOffer.isPending

    const [error, setError] = useState<OrderErrorMessage | null>(null)

    const FormSchema = useMemo(
        () => OfferValuesSchema((field: OfferMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const form = useForm<OfferValuesFormInput, unknown, OfferValuesForm>({
        resolver: zodResolver(FormSchema),
        values: defaults(currency, offer),
    })

    const { control, setValue } = form
    const total = useWatch({ control, name: "total" })
    const fiscalRegime = useWatch({ control, name: "fiscalRegime" })
    const includesGit = useWatch({ control, name: "includesGit" })
    const includesGps = useWatch({ control, name: "includesGps" })

    // The quote is one number; VAT and the subtotal follow from it and the
    // regime, exactly as Appload's own offer form derives them
    useEffect(() => {
        if (total === undefined || total === null || total === "") return

        const amount = Number(total)
        if (!Number.isFinite(amount)) return

        const vat = fiscalRegime === "normal" ? amount * VAT_RATE : 0

        setValue("vat", round(vat))
        setValue("subtotal", round(amount - vat))
    }, [total, fiscalRegime, setValue])

    function onSubmit(values: OfferValuesForm) {
        setError(null)

        const callbacks = {
            onSuccess: () => onOpenChange(false),
            onError: (failure: unknown) => setError(orderErrorKey(failure)),
        }

        if (offer) {
            updateOffer.mutate({ offerId: offer.id, patch: values }, callbacks)
            return
        }

        createOffer.mutate({ orderId, values }, callbacks)
    }

    const includes = [
        { name: "includesGit" as const, checked: Boolean(includesGit), icon: IconShieldCheck, label: t("includes.git"), hint: t("form.git-hint") },
        { name: "includesGps" as const, checked: Boolean(includesGps), icon: IconMapPin, label: t("includes.gps"), hint: t("form.gps-hint") },
    ]

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next) }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t(offer ? "form.edit-title" : "form.title")}</DialogTitle>
                    <DialogDescription>{t("form.description")}</DialogDescription>
                </DialogHeader>

                <form id="offer-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                            <SelectInput
                                control={control}
                                name="fiscalRegime"
                                isPending={isPending}
                                label={t("fields.fiscalRegime")}
                                placeholder={t("form.fiscalRegime-placeholder")}
                            >
                                {FISCAL_REGIME.map((item) => (
                                    <SelectItem key={item} value={item}>{tv(`fiscalRegime.${item}`)}</SelectItem>
                                ))}
                            </SelectInput>

                            <SelectInput
                                control={control}
                                name="currency"
                                isPending={isPending}
                                label={t("fields.currency")}
                                placeholder={t("form.currency-placeholder")}
                            >
                                {CURRENCY.map((item) => (
                                    <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                                ))}
                            </SelectInput>
                        </FieldGroup>

                        <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
                            <DecimalInput
                                control={control}
                                name="total"
                                isPending={isPending}
                                label={t("fields.total")}
                                placeholder={t("form.total-placeholder")}
                                description={t("form.total-description")}
                            />

                            <DecimalInput
                                control={control}
                                name="vat"
                                disabled
                                label={t("fields.vat")}
                                placeholder={t("form.derived")}
                            />

                            <DecimalInput
                                control={control}
                                name="subtotal"
                                disabled
                                label={t("fields.subtotal")}
                                placeholder={t("form.derived")}
                            />
                        </FieldGroup>

                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">{t("fields.includes")}</span>

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {includes.map(({ name, checked, icon: Icon, label, hint }) => (
                                    <button
                                        key={name}
                                        type="button"
                                        role="checkbox"
                                        aria-checked={checked}
                                        disabled={isPending}
                                        onClick={() => setValue(name, !checked, { shouldDirty: true })}
                                        className={cn(
                                            "flex cursor-pointer items-start gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
                                            checked ? "border-primary bg-primary/5" : "hover:bg-muted",
                                        )}
                                    >
                                        <Icon className="mt-0.5 size-3.5 shrink-0" stroke={1.5} />
                                        <span className="min-w-0">
                                            <span className="block font-medium">{label}</span>
                                            <span className="text-muted-foreground block text-xs">{hint}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <TextAreaInput
                            control={control}
                            name="notes"
                            isPending={isPending}
                            label={t("fields.notes")}
                            placeholder={t("form.notes-placeholder")}
                        />

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        {t("form.cancel")}
                    </Button>
                    <Button type="submit" form="offer-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {t(offer ? "form.save" : "form.send")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
