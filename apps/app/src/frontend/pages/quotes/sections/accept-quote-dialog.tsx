"use client"

import { useEffect, useMemo, useRef } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconArrowNarrowRight, IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react"

import { useLocale, useTranslations } from "@workspace/i18n"
import { CATEGORIES, LOAD_TYPE, PACKING, WEIGHT_UNIT } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { SelectItem } from "@workspace/ui/components/select"
import { SelectInput } from "@workspace/ui/inputs/select"
import { NumberInput } from "@workspace/ui/inputs/number"
import { WeightInput } from "@workspace/ui/inputs/weight"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { TextInput } from "@workspace/ui/inputs/text"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { distanceCalculator } from "@workspace/ui/lib/google"
import { FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useRouter } from "@/i18n/navigation"
import { planRefusal, type PlanReason } from "@/components/plan-dialog"
import { useMoney } from "@/frontend/pages/quotes/sections/badges"
import { useQuoteMutations } from "@/frontend/pages/quotes/hooks/use-quote-mutations"
import type { QuoteDetail } from "@/frontend/pages/quotes/types"
import {
    AcceptQuoteSchema,
    type AcceptQuoteForm,
    type AcceptQuoteFormInput,
} from "@/backend/schemas/quote"

const defaults = (quote: QuoteDetail): AcceptQuoteFormInput => ({
    id: quote.id,
    cargo: {
        category: undefined as never,
        description: "",
        weight: "",
        weightUnit: "ton",
        loadType: undefined as never,
        packing: undefined,
        // The quote's own loading date is the offer's day; the client may
        // move it, and a quote that named none has to name one here
        expectedLoadingDate: quote.loadingDate ?? undefined,
        expectedOffloadingDate: undefined,
        distance: "",
        deliveries: "1",
        expectedTrucks: "1",
        isHazardous: false,
        hazchemCode: "",
        isRefrigerated: false,
        temperature: "",
        temperatureInstructions: "",
    },
})

/**
 * Accepting a standing quote: the cargo the quote never carried.
 *
 * The lane, the carrier and the price are already decided — this form only
 * adds what an order needs, and the road distance is looked up from the
 * quote's two endpoints the moment the dialog opens (the portal has no
 * Routes credentials server-side, so the browser measures the lane). It
 * stays editable: a lookup that fails must not block a booking.
 */
export function AcceptQuoteDialog({
    quote,
    open,
    onOpenChange,
    onAccepted,
    onPlanRequired,
}: {
    quote: QuoteDetail
    open: boolean
    onOpenChange: (open: boolean) => void
    onAccepted?: () => void
    /** The allowance ran out between opening this form and submitting it */
    onPlanRequired: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.quotes")
    const locale = useLocale()
    const money = useMoney()
    const router = useRouter()

    const { accept } = useQuoteMutations()
    const isPending = accept.isPending

    const FormSchema = useMemo(
        () => AcceptQuoteSchema((field) => ({ error: t(`form.errors.${field}`) })),
        [t],
    )

    const form = useForm<AcceptQuoteFormInput, unknown, AcceptQuoteForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaults(quote),
    })

    const { reset, setValue } = form
    const routeToken = useRef(0)

    // A reopened dialog starts clean, and each opening re-measures the lane
    useEffect(() => {
        if (!open) return

        reset(defaults(quote))

        const token = ++routeToken.current

        void distanceCalculator(quote.origin.placeId, quote.destination.placeId, locale).then((rows) => {
            // A newer opening superseded this request while it was in flight
            if (token !== routeToken.current) return

            const meters = rows?.[0]?.elements?.[0]?.distance?.value

            if (typeof meters === "number") {
                setValue("cargo.distance", String(Math.round(meters / 1000)))
            }
        })
    }, [open, quote, locale, reset, setValue])

    const weightUnit = useWatch({ control: form.control, name: "cargo.weightUnit" })
    const loadingDate = useWatch({ control: form.control, name: "cargo.expectedLoadingDate" })
    const isHazardous = useWatch({ control: form.control, name: "cargo.isHazardous" })
    const isRefrigerated = useWatch({ control: form.control, name: "cargo.isRefrigerated" })

    function onSubmit(values: AcceptQuoteForm) {
        accept.mutate(values, {
            onSuccess: ({ orderId }) => {
                onOpenChange(false)
                onAccepted?.()
                router.push({ pathname: "/appload/details/[orderId]", params: { orderId } })
            },
            onError: (failure) => {
                // Not a booking this form can complete: hand over to the
                // dialog that explains the plan
                const refusal = planRefusal(failure)

                if (refusal) onPlanRequired(refusal)
            },
        })
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next) }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t("accept.title")}</DialogTitle>
                    <DialogDescription>{t("accept.description")}</DialogDescription>
                </DialogHeader>

                <div className="bg-muted/40 flex flex-col gap-1 rounded-2xl px-4 py-3 text-sm">
                    <span className="font-medium">{quote.partner.name}</span>
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{quote.origin.address}</span>
                        <IconArrowNarrowRight className="size-4 shrink-0" stroke={1.5} />
                        <span className="truncate">{quote.destination.address}</span>
                    </span>
                    <span className="font-semibold tabular-nums">
                        {money(quote.money.total, quote.money.currency)}
                    </span>
                </div>

                <form
                    id="accept-quote-form"
                    onSubmit={(event) => {
                        // The dialog renders in a portal, so React bubbles this
                        // submit to whatever form opened it
                        event.stopPropagation()
                        void form.handleSubmit(onSubmit)(event)
                    }}
                >
                    <FieldGroup className="gap-6">
                        <FieldSet>
                            <FieldLegend variant="label">
                                <FieldTitle>{t("accept.cargo")}</FieldTitle>
                            </FieldLegend>

                            <FieldGroup className="gap-4">
                                <SelectInput
                                    name="cargo.category"
                                    control={form.control}
                                    isPending={isPending}
                                    label={t("accept.fields.category.label")}
                                    placeholder={t("accept.fields.category.placeholder")}
                                >
                                    {CATEGORIES.map((value) => (
                                        <SelectItem key={value} value={value}>{t(`category.${value}`)}</SelectItem>
                                    ))}
                                </SelectInput>

                                <TextAreaInput
                                    name="cargo.description"
                                    control={form.control}
                                    isPending={isPending}
                                    label={t("accept.fields.description.label")}
                                    placeholder={t("accept.fields.description.placeholder")}
                                />

                                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                                    <WeightInput
                                        name="cargo.weight"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.weight.label")}
                                        placeholder={t("accept.fields.weight.placeholder")}
                                        value={(weightUnit ?? "ton") as (typeof WEIGHT_UNIT)[number]}
                                        setValue={(value) => setValue("cargo.weightUnit", value)}
                                    />

                                    <SelectInput
                                        name="cargo.loadType"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.loadType.label")}
                                        placeholder={t("accept.fields.loadType.placeholder")}
                                    >
                                        {LOAD_TYPE.map((value) => (
                                            <SelectItem key={value} value={value}>{t(`load-type.${value}`)}</SelectItem>
                                        ))}
                                    </SelectInput>

                                    <SelectInput
                                        name="cargo.packing"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.packing.label")}
                                        placeholder={t("accept.fields.packing.placeholder")}
                                    >
                                        {PACKING.map((value) => (
                                            <SelectItem key={value} value={value}>{t(`packing.${value}`)}</SelectItem>
                                        ))}
                                    </SelectInput>

                                    <NumberInput
                                        name="cargo.deliveries"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.deliveries.label")}
                                        placeholder={t("accept.fields.deliveries.placeholder")}
                                    />

                                    <NumberInput
                                        name="cargo.expectedTrucks"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.trucks.label")}
                                        placeholder={t("accept.fields.trucks.placeholder")}
                                    />
                                </div>
                            </FieldGroup>
                        </FieldSet>

                        <FieldSet>
                            <FieldLegend variant="label">
                                <FieldTitle>{t("accept.schedule")}</FieldTitle>
                            </FieldLegend>

                            <FieldGroup className="gap-4">
                                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                                    <DateInput
                                        name="cargo.expectedLoadingDate"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.loadingDate.label")}
                                        placeholder={t("accept.fields.loadingDate.placeholder")}
                                    />

                                    <DateInput
                                        name="cargo.expectedOffloadingDate"
                                        control={form.control}
                                        isPending={isPending}
                                        value={loadingDate}
                                        label={t("accept.fields.offloadingDate.label")}
                                        placeholder={t("accept.fields.offloadingDate.placeholder")}
                                    />
                                </div>

                                <NumberInput
                                    name="cargo.distance"
                                    control={form.control}
                                    isPending={isPending}
                                    label={t("accept.fields.distance.label")}
                                    placeholder={t("accept.fields.distance.placeholder")}
                                    description={t("accept.fields.distance.description")}
                                />
                            </FieldGroup>
                        </FieldSet>

                        <FieldSet>
                            <FieldLegend variant="label">
                                <FieldTitle>{t("accept.handling")}</FieldTitle>
                            </FieldLegend>

                            <FieldGroup className="gap-4">
                                <CheckboxInput
                                    name="cargo.isHazardous"
                                    control={form.control}
                                    isPending={isPending}
                                    label={t("accept.fields.hazardous.label")}
                                    description={t("accept.fields.hazardous.description")}
                                />

                                {isHazardous && (
                                    <TextInput
                                        name="cargo.hazchemCode"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("accept.fields.hazchem.label")}
                                        placeholder={t("accept.fields.hazchem.placeholder")}
                                    />
                                )}

                                <CheckboxInput
                                    name="cargo.isRefrigerated"
                                    control={form.control}
                                    isPending={isPending}
                                    label={t("accept.fields.refrigerated.label")}
                                    description={t("accept.fields.refrigerated.description")}
                                />

                                {isRefrigerated && (
                                    <>
                                        <DecimalInput
                                            name="cargo.temperature"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("accept.fields.temperature.label")}
                                            placeholder={t("accept.fields.temperature.placeholder")}
                                        />

                                        <TextAreaInput
                                            name="cargo.temperatureInstructions"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("accept.fields.temperatureInstructions.label")}
                                            placeholder={t("accept.fields.temperatureInstructions.placeholder")}
                                        />
                                    </>
                                )}
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button type="submit" form="accept-quote-form" disabled={isPending}>
                        {isPending
                            ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                            : <IconCheck className="size-4" stroke={1.5} />}
                        {isPending ? t("accept.actions.booking") : t("accept.actions.book")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel className="size-4" stroke={1.5} />
                        {t("actions.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
