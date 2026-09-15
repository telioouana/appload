"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { SelectInput } from "@workspace/ui/inputs/select"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { DateInput } from "@workspace/ui/inputs/date"
import { TextInput } from "@workspace/ui/inputs/text"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import { PaymentFormSchema, type PaymentForm, type PaymentMessageField } from "@/backend/schemas/movement"
import type { MovementDetail } from "@/frontend/pages/movements/types"

// Payments are booked after the fact; the calendar opens two years back
const SINCE = new Date(new Date().getFullYear() - 2, 0, 1)

/**
 * Money that moved against one leg: received from the client, or paid to
 * the partner. The leg keeps a running total and its settlement follows from
 * it. A payment typed wrong is corrected by a line of its own that takes it
 * back — with a reference saying why — rather than by editing the first one,
 * so the books show both.
 */
export function PaymentDialog({ load, onClose }: { load: MovementDetail; onClose: () => void }) {
    const t = useTranslations("App.loads.payment")
    const tl = useTranslations("App.loads")
    const money = useMoney()

    const { recordPayment } = useMovementMutations()
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    // The owner is the only one who records payments: its receivable is the
    // sell leg, its payable the buy leg
    const { receivable, payable } = load.money
    const legs = [
        ...(receivable ? [{ value: "sell" as const, label: t("legs.sell"), leg: receivable }] : []),
        ...(payable ? [{ value: "buy" as const, label: t("legs.buy"), leg: payable }] : []),
    ]

    const FormSchema = useMemo(
        () => PaymentFormSchema((field: PaymentMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const form = useForm<PaymentForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            leg: legs[0]?.value ?? "sell",
            amount: "",
            paidAt: new Date(),
            reference: "",
            correction: false,
        },
    })

    const leg = useWatch({ control: form.control, name: "leg" })
    const current = legs.find((entry) => entry.value === leg)?.leg

    function onSubmit(values: PaymentForm) {
        setError(null)

        const amount = Number(values.amount)

        recordPayment.mutate(
            {
                id: load.id,
                expectedVersion: load.version,
                leg: values.leg,
                amount: values.correction ? -amount : amount,
                paidAt: values.paidAt,
                reference: values.reference.trim() || undefined,
            },
            {
                onSuccess: onClose,
                onError: (failure) => setError(movementErrorKey(failure)),
            },
        )
    }

    const isPending = recordPayment.isPending

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { ref: load.ref })}</DialogDescription>
                </DialogHeader>

                <form id="payment-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        {legs.length > 1 && (
                            <SelectInput control={form.control} name="leg" isPending={isPending} label={t("fields.leg")}>
                                {legs.map((entry) => (
                                    <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                                ))}
                            </SelectInput>
                        )}

                        {current && (
                            <p className="text-muted-foreground text-xs tabular-nums">
                                {t("progress", {
                                    settled: money(current.settled, current.currency),
                                    total: money(current.total, current.currency),
                                })}
                            </p>
                        )}

                        <DecimalInput
                            control={form.control}
                            name="amount"
                            isPending={isPending}
                            label={t("fields.amount", { currency: current?.currency ?? "" })}
                            placeholder={t("fields.amount-placeholder")}
                        />

                        <DateInput
                            control={form.control}
                            name="paidAt"
                            isPending={isPending}
                            value={SINCE}
                            label={t("fields.paid-at")}
                        />

                        <TextInput
                            control={form.control}
                            name="reference"
                            isPending={isPending}
                            label={t("fields.reference")}
                            placeholder={t("fields.reference-placeholder")}
                        />

                        <CheckboxInput
                            control={form.control}
                            name="correction"
                            isPending={isPending}
                            label={t("fields.correction")}
                            description={t("fields.correction-hint")}
                        />

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{tl(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>
                        {tl("dialogs.back")}
                    </Button>
                    <Button type="submit" form="payment-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {t("submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
