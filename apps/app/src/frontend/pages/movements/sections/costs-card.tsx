"use client"

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { CURRENCY } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { SelectInput } from "@workspace/ui/inputs/select"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { DateInput } from "@workspace/ui/inputs/date"
import { TextInput } from "@workspace/ui/inputs/text"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import { CostFormSchema, MOVEMENT_COST_KIND, type CostForm, type CostMessageField } from "@/backend/schemas/movement"
import type { Currency, MovementDetail } from "@/frontend/pages/movements/types"

// Costs are booked after the fact; the calendar opens two years back
const SINCE = new Date(new Date().getFullYear() - 2, 0, 1)

/**
 * What the load cost to run, one line at a time: fuel, tolls, the driver's
 * allowance, border fees. The owner's alone — no partner and no client ever
 * reads it. A line marked rechargeable is passed on to the client, so it
 * does not come out of the margin.
 */
export function CostsCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.costs")
    const f = useFormatter()
    const money = useMoney()

    const { removeCost } = useMovementMutations()
    const [adding, setAdding] = useState(false)

    const canManage = load.permissions.canManageCosts

    return (
        <SectionCard
            title={t("title")}
            count={load.costs.length}
            actions={canManage ? (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <IconPlus className="size-4" stroke={1.5} />
                    {t("add")}
                </Button>
            ) : undefined}
        >
            {load.costs.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <ul className="flex flex-col divide-y">
                    {load.costs.map((cost) => (
                        <li key={cost.id} className="flex items-center justify-between gap-4 py-2 text-[13px] first:pt-0 last:pb-0">
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium">{t(`kinds.${cost.kind}`)}</span>
                                <span className="text-muted-foreground truncate text-xs">
                                    {[
                                        f.dateTime(cost.incurredAt, { dateStyle: "medium" }),
                                        cost.rechargeable ? t("rechargeable") : null,
                                        cost.description,
                                    ].filter(Boolean).join(" · ")}
                                </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <span className="tabular-nums">{money(cost.amount, cost.currency)}</span>
                                {canManage && (
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={t("remove")}
                                        disabled={removeCost.isPending}
                                        onClick={() => removeCost.mutate({ id: cost.id })}
                                    >
                                        <IconTrash className="size-4" stroke={1.5} />
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {adding && (
                <CostDialog
                    loadId={load.id}
                    currency={load.money.receivable?.currency ?? load.money.payable?.currency ?? "MZN"}
                    onClose={() => setAdding(false)}
                />
            )}
        </SectionCard>
    )
}

function CostDialog({ loadId, currency, onClose }: { loadId: string; currency: Currency; onClose: () => void }) {
    const t = useTranslations("App.loads.costs")
    const tl = useTranslations("App.loads")
    const tv = useTranslations("App.orders")

    const { addCost } = useMovementMutations()
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const FormSchema = useMemo(
        () => CostFormSchema((field: CostMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const form = useForm<CostForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            kind: "fuel",
            description: "",
            amount: "",
            currency,
            incurredAt: new Date(),
            rechargeable: false,
        },
    })

    function onSubmit(values: CostForm) {
        setError(null)

        addCost.mutate(
            {
                movementId: loadId,
                kind: values.kind,
                description: values.description.trim() || undefined,
                amount: Number(values.amount),
                currency: values.currency,
                incurredAt: values.incurredAt,
                rechargeable: values.rechargeable,
            },
            {
                onSuccess: onClose,
                onError: (failure) => setError(movementErrorKey(failure)),
            },
        )
    }

    const isPending = addCost.isPending

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("dialog.title")}</DialogTitle>
                    <DialogDescription>{t("dialog.description")}</DialogDescription>
                </DialogHeader>

                <form id="cost-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <SelectInput control={form.control} name="kind" isPending={isPending} label={t("fields.kind")}>
                            {MOVEMENT_COST_KIND.map((kind) => (
                                <SelectItem key={kind} value={kind}>{t(`kinds.${kind}`)}</SelectItem>
                            ))}
                        </SelectInput>

                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                            <DecimalInput
                                control={form.control}
                                name="amount"
                                isPending={isPending}
                                label={t("fields.amount")}
                                placeholder={t("fields.amount-placeholder")}
                            />
                            <SelectInput control={form.control} name="currency" isPending={isPending} label={t("fields.currency")}>
                                {CURRENCY.map((item) => (
                                    <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                                ))}
                            </SelectInput>
                        </FieldGroup>

                        <DateInput
                            control={form.control}
                            name="incurredAt"
                            isPending={isPending}
                            value={SINCE}
                            label={t("fields.incurred-at")}
                        />

                        <TextInput
                            control={form.control}
                            name="description"
                            isPending={isPending}
                            label={t("fields.description")}
                            placeholder={t("fields.description-placeholder")}
                        />

                        <CheckboxInput
                            control={form.control}
                            name="rechargeable"
                            isPending={isPending}
                            label={t("fields.rechargeable")}
                            description={t("fields.rechargeable-hint")}
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
                    <Button type="submit" form="cost-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {t("dialog.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
